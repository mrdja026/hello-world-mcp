import axios from "axios";

export class PerplexityTool {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = 60 * 60 * 1000; // 1 hour TTL
  }

  getToolDefinition() {
    return {
      name: "fetch_perplexity_data",
      description:
        "Search for real-time information using Perplexity AI with intelligent domain and recency filtering",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query to send to Perplexity AI",
          },
          space_name: {
            type: "string",
            description: "Perplexity Space name to explore (e.g., 'RAG')",
          },
          user: {
            type: "string",
            description: "Perplexity user handle or name to look up",
          },
          domain: {
            type: "string",
            description:
              "Domain filter (e.g., 'github.com', 'stackoverflow.com', 'docs.*')",
            enum: [
              "github.com",
              "stackoverflow.com",
              "docs.*",
              "reddit.com",
              "medium.com",
              "dev.to",
            ],
          },
          recency: {
            type: "string",
            description: "Time-based filter for search results",
            enum: ["day", "week", "month", "year"],
          },
          max_results: {
            type: "integer",
            description: "Maximum number of search results to return (1-10)",
            minimum: 1,
            maximum: 10,
            default: 5,
          },
        },
        required: [],
      },
    };
  }

  getCacheKey(query, domain, recency, maxResults) {
    return `${query}|${domain || ""}|${recency || ""}|${maxResults || 5}`;
  }

  async execute(args, authContext = {}) {
    const {
      query,
      space_name,
      user,
      domain: domainArg,
      recency,
      max_results = 5,
    } = args || {};

    if (!query && !space_name && !user) {
      throw new Error("Provide either 'query', 'space_name', or 'user'");
    }

    // Check cache first
    let queryForCache = query || "";
    if (!queryForCache) {
      if (space_name) queryForCache = `space:${space_name}`;
      else if (user) queryForCache = `user:${user}`;
    }
    const domainForCache =
      domainArg || (space_name || user ? "perplexity.ai" : undefined);
    const cacheKey = this.getCacheKey(
      queryForCache,
      domainForCache,
      recency,
      max_results
    );
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ...cached.data,
              cache_hit: true,
              cached_at: new Date(cached.timestamp).toISOString(),
            }),
          },
        ],
      };
    }

    // Get API key from auth context or environment
    const apiKey = authContext.perplexityKey || process.env.PERPLEXITY_API_KEY;

    if (!apiKey) {
      throw new Error(
        "Perplexity API key is required. " +
          "Set PERPLEXITY_API_KEY environment variable or provide X-Perplexity-Key header."
      );
    }

    try {
      // Build enhanced query with domain and recency filters
      let enhancedQuery = "";
      let effectiveDomain = domainArg;
      if (space_name) {
        enhancedQuery = `Perplexity Space "${space_name}"`;
        effectiveDomain = effectiveDomain || "perplexity.ai";
      } else if (user) {
        enhancedQuery = `Perplexity user "${user}" profile`;
        effectiveDomain = effectiveDomain || "perplexity.ai";
      } else {
        enhancedQuery = query;
      }
      if (effectiveDomain) {
        enhancedQuery += ` site:${effectiveDomain}`;
      }
      if (recency) {
        const recencyMap = {
          day: "after:1d",
          week: "after:7d",
          month: "after:30d",
          year: "after:365d",
        };
        enhancedQuery += ` ${recencyMap[recency]}`;
      }

      const response = await axios.post(
        "https://api.perplexity.ai/chat/completions",
        {
          model:
            process.env.PERPLEXITY_MODEL || "llama-3.1-sonar-small-128k-online",
          messages: [
            {
              role: "system",
              content:
                "You are a helpful research assistant. Provide comprehensive, accurate information with relevant sources and citations.",
            },
            {
              role: "user",
              content: enhancedQuery,
            },
          ],
          max_tokens: 2000,
          temperature: 0.2,
          return_citations: true,
          search_domain_filter: effectiveDomain ? [effectiveDomain] : undefined,
          search_recency_filter: recency || undefined,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 30000,
        }
      );

      const result = response.data;
      const choice = result.choices?.[0];
      const content = choice?.message?.content || "No content received";
      const citations = result.citations || [];

      // Extract sources from citations
      const sources = citations
        .slice(0, max_results)
        .map((citation, index) => ({
          id: index + 1,
          name: citation.title || `Source ${index + 1}`,
          url: citation.url || "",
          snippet: citation.text || "",
        }));

      const searchResult = {
        search_metadata: {
          query: enhancedQuery,
          original_query: query || null,
          space_name: space_name || null,
          user: user || null,
          timestamp: new Date().toISOString(),
          domain_filter: effectiveDomain || null,
          recency_filter: recency || null,
          max_results,
        },
        content,
        sources,
        citations: citations.map((c) => c.title || c.url).filter(Boolean),
        usage: result.usage || {},
        cache_hit: false,
      };

      // Cache the result
      this.cache.set(cacheKey, {
        data: searchResult,
        timestamp: Date.now(),
      });

      // Clean up old cache entries (simple cleanup)
      if (this.cache.size > 100) {
        const entries = Array.from(this.cache.entries());
        const cutoff = Date.now() - this.cacheExpiry;
        entries.forEach(([key, value]) => {
          if (value.timestamp < cutoff) {
            this.cache.delete(key);
          }
        });
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(searchResult),
          },
        ],
      };
    } catch (error) {
      console.error("Perplexity API error:", error);

      if (error.response) {
        const status = error.response.status;
        const message =
          error.response.data?.error?.message || error.response.statusText;

        if (status === 401) {
          throw new Error("Invalid Perplexity API key");
        } else if (status === 429) {
          throw new Error("Perplexity API rate limit exceeded");
        } else if (status >= 500) {
          throw new Error("Perplexity API server error");
        } else {
          throw new Error(`Perplexity API error (${status}): ${message}`);
        }
      } else if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
        throw new Error("Cannot connect to Perplexity API");
      } else if (error.code === "ECONNABORTED") {
        throw new Error("Perplexity API request timeout");
      } else {
        throw new Error(`Perplexity search failed: ${error.message}`);
      }
    }
  }
}
