#!/usr/bin/env node

import express from "express";
import cors from "cors";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class HTTPBridge {
  constructor() {
    this.app = express();
    this.child = null;
    this.inflight = new Map();
    this.buffer = "";
    this.requestId = 1;
    this.isRestarting = false;
    this.restartCount = 0;
    this.maxRestarts = 5;

    // MCP initialization state
    this.initialized = false;
    this.initPromise = null;

    // Request-scoped credentials storage
    this.requestCredentials = new Map(); // requestId -> { perplexityKey }

    this.setupExpress();
    this.spawnChild();
  }

  async initializeChild() {
    if (this.initPromise) return this.initPromise;

    const id = this.requestId++;
    const msg = {
      jsonrpc: "2.0",
      method: "initialize",
      id,
      params: {
        protocolVersion: "2024-09-01",
        clientInfo: { name: "http-bridge", version: "1.0.0" },
        capabilities: {},
      },
    };

    this.initPromise = this.sendToChild(msg)
      .then(() => {
        this.initialized = true;
        console.error("[BRIDGE] MCP initialization completed");
      })
      .catch((e) => {
        this.initPromise = null;
        console.error("[BRIDGE] MCP initialization failed:", e.message);
        throw e;
      });

    return this.initPromise;
  }

  // Map external method names to MCP SDK expected names
  normalizeMethod(method, params) {
    switch (method) {
      case "listTools":
      case "tools/list":
        return { method: "tools/list", params: {} };
      case "callTool":
      case "tools/call":
        return { method: "tools/call", params };
      case "listResources":
      case "resources/list":
        return { method: "resources/list", params: {} };
      case "readResource":
      case "resources/read":
        return { method: "resources/read", params };
      default:
        return { method, params };
    }
  }

  setupExpress() {
    // CORS for localhost only
    this.app.use(
      cors({
        origin: [
          "http://localhost:8080",
          "http://127.0.0.1:8080",
          "http://localhost:4000",
          "http://127.0.0.1:4000",
        ],
        credentials: true,
      })
    );

    this.app.use(express.json({ limit: "10mb" }));

    // Health check endpoint
    this.app.get("/health", (req, res) => {
      res.json({
        status: "ok",
        transport: "http-bridge",
        stdio_child: this.child ? "running" : "stopped",
        mcp_initialized: this.initialized,
        inflight_requests: this.inflight.size,
        restart_count: this.restartCount,
        production_ready: this.initialized && this.child && !this.child.killed,
      });
    });

    // Main MCP JSON-RPC endpoint
    this.app.post("/mcp", async (req, res) => {
      const startTime = Date.now();
      const { method, params, id = this.requestId++ } = req.body || {};

      // Optional bearer token auth
      const authToken = process.env.MCP_HTTP_TOKEN;
      if (authToken && req.headers.authorization !== `Bearer ${authToken}`) {
        return res.status(401).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Unauthorized" },
          id,
        });
      }

      // Extract per-request credentials from headers
      const perplexityKey = req.headers["x-perplexity-key"];

      // Store credentials for this request (will be cleaned up after response)
      if (perplexityKey) {
        this.requestCredentials.set(id, { perplexityKey });
      }

      try {
        if (!this.child || this.child.killed) {
          throw new Error("STDIO child process is not running");
        }

        // Ensure MCP initialize handshake completed
        await this.initializeChild();

        // Map method names to MCP SDK expected format
        const normalized = this.normalizeMethod(method, params);

        // Inject auth context for tools that need per-request credentials
        let enhancedParams = normalized.params;
        if (
          perplexityKey &&
          normalized.method === "tools/call" &&
          normalized.params?.name === "fetch_perplexity_data"
        ) {
          enhancedParams = {
            ...normalized.params,
            _auth: { perplexityKey }, // Internal auth envelope, not logged
          };
        }

        const result = await this.sendToChild({
          jsonrpc: "2.0",
          method: normalized.method,
          params: enhancedParams,
          id,
        });

        // Clean up credentials after request completion
        this.requestCredentials.delete(id);

        const duration = Date.now() - startTime;

        console.error(
          `[BRIDGE] ${normalized.method} completed in ${duration}ms`
        );

        if (duration > 5000) {
          console.error(
            `[BRIDGE] SLO_WARNING: ${normalized.method} took ${duration}ms (>5s)`
          );
        }

        res.json(result);
      } catch (error) {
        // Clean up credentials on error
        this.requestCredentials.delete(id);

        const duration = Date.now() - startTime;
        console.error(
          `[BRIDGE] ${method} failed after ${duration}ms:`,
          error.message
        );

        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error.message || "Internal error",
          },
          id,
        });
      }
    });
  }

  spawnChild() {
    if (this.child) {
      this.child.kill();
    }

    console.error("[BRIDGE] Spawning STDIO child process...");

    const stdioPath = join(__dirname, "stdio.js");
    this.child = spawn(process.execPath, [stdioPath], {
      stdio: ["pipe", "pipe", "inherit"],
      env: process.env,
    });

    this.child.stdin.setEncoding("utf8");
    this.child.stdout.setEncoding("utf8");

    this.buffer = "";
    this.child.stdout.on("data", (chunk) => {
      this.handleChildOutput(chunk);
    });

    this.child.on("error", (error) => {
      console.error("[BRIDGE] Child process error:", error);
      this.handleChildExit(1);
    });

    this.child.on("exit", (code, signal) => {
      console.error(
        `[BRIDGE] Child process exited with code ${code}, signal ${signal}`
      );
      this.handleChildExit(code);
    });

    // Initialize MCP handshake after child starts
    setTimeout(async () => {
      try {
        await this.initializeChild();
        console.error("[BRIDGE] STDIO child process ready");
      } catch (e) {
        console.error("[BRIDGE] Initialize failed:", e.message);
      }
    }, 500);
  }

  handleChildOutput(chunk) {
    this.buffer += chunk;
    let newlineIndex;

    while ((newlineIndex = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line);
        const resolver = this.inflight.get(message.id);

        if (resolver) {
          this.inflight.delete(message.id);
          resolver.resolve(message);
        } else {
          console.error(
            "[BRIDGE] Received response for unknown request ID:",
            message.id
          );
        }
      } catch (error) {
        console.error(
          "[BRIDGE] Failed to parse child output:",
          line,
          error.message
        );
      }
    }
  }

  handleChildExit(code) {
    // Reset initialization state
    this.initialized = false;
    this.initPromise = null;

    // Reject all pending requests
    for (const [id, resolver] of this.inflight.entries()) {
      resolver.reject(new Error("Child process exited"));
    }
    this.inflight.clear();

    // Auto-restart logic
    if (!this.isRestarting && this.restartCount < this.maxRestarts) {
      this.isRestarting = true;
      this.restartCount++;

      console.error(
        `[BRIDGE] Auto-restarting child process (attempt ${this.restartCount}/${this.maxRestarts})`
      );

      setTimeout(() => {
        this.spawnChild();
        this.isRestarting = false;
      }, 1000 * this.restartCount); // Exponential backoff
    } else {
      console.error(
        `[BRIDGE] Child process restart limit reached (${this.maxRestarts})`
      );
    }
  }

  sendToChild(message) {
    return new Promise((resolve, reject) => {
      if (!this.child || this.child.killed) {
        reject(new Error("Child process is not running"));
        return;
      }

      const timeout = setTimeout(() => {
        if (this.inflight.delete(message.id)) {
          reject(new Error("Request timeout (60s)"));
        }
      }, 60000);

      this.inflight.set(message.id, {
        resolve: (response) => {
          clearTimeout(timeout);
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      const data = JSON.stringify(message) + "\n";
      this.child.stdin.write(data, (error) => {
        if (error) {
          if (this.inflight.delete(message.id)) {
            clearTimeout(timeout);
            reject(new Error(`Failed to write to child: ${error.message}`));
          }
        }
      });
    });
  }

  listen(port = 4000) {
    return new Promise((resolve, reject) => {
      const server = this.app.listen(port, "127.0.0.1", () => {
        console.error(
          `[BRIDGE] MCP HTTP bridge running on http://127.0.0.1:${port}`
        );
        resolve(server);
      });

      server.on("error", reject);
    });
  }
}

// Start the HTTP bridge
const bridge = new HTTPBridge();
const port = parseInt(process.env.MCP_HTTP_PORT || "4000", 10);

bridge.listen(port).catch((error) => {
  console.error("[BRIDGE] Failed to start:", error);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.error("[BRIDGE] Shutting down...");
  if (bridge.child) {
    bridge.child.kill();
  }
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.error("[BRIDGE] Shutting down...");
  if (bridge.child) {
    bridge.child.kill();
  }
  process.exit(0);
});
