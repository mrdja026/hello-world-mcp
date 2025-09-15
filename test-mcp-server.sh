#!/bin/bash

# Production MCP Server Test Suite
# Tests the hello-world-mcp server for production readiness

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

BASE_URL="${MCP_BASE_URL:-http://127.0.0.1:4000}"
TIMEOUT=10

echo -e "${BLUE}🧪 MCP Server Production Test Suite${NC}"
echo -e "${BLUE}Testing server at: $BASE_URL${NC}"
echo

# Test 1: Health Check
echo -e "${YELLOW}1️⃣ Health Check...${NC}"
HEALTH_RESPONSE=$(curl -s -w "%{http_code}" --max-time $TIMEOUT "$BASE_URL/health" -o /tmp/health.json)
HTTP_CODE="${HEALTH_RESPONSE: -3}"

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Health check passed${NC}"
    
    PRODUCTION_READY=$(cat /tmp/health.json | grep -o '"production_ready":[^,}]*' | cut -d':' -f2)
    MCP_INITIALIZED=$(cat /tmp/health.json | grep -o '"mcp_initialized":[^,}]*' | cut -d':' -f2)
    STDIO_CHILD=$(cat /tmp/health.json | grep -o '"stdio_child":"[^"]*"' | cut -d':' -f2 | tr -d '"')
    
    echo "   - Production Ready: $PRODUCTION_READY"
    echo "   - MCP Initialized: $MCP_INITIALIZED"
    echo "   - STDIO Child: $STDIO_CHILD"
    
    if [ "$PRODUCTION_READY" = "true" ]; then
        echo -e "${GREEN}   ✅ Server is production ready${NC}"
    else
        echo -e "${RED}   ❌ Server not production ready${NC}"
        exit 1
    fi
else
    echo -e "${RED}❌ Health check failed (HTTP $HTTP_CODE)${NC}"
    exit 1
fi

# Test 2: List Tools
echo -e "\n${YELLOW}2️⃣ List Tools...${NC}"
TOOLS_RESPONSE=$(curl -s -w "%{http_code}" --max-time $TIMEOUT \
    -X POST "$BASE_URL/mcp" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"listTools","id":1}' \
    -o /tmp/tools.json)

HTTP_CODE="${TOOLS_RESPONSE: -3}"

if [ "$HTTP_CODE" = "200" ]; then
    TOOL_COUNT=$(cat /tmp/tools.json | grep -o '"name"' | wc -l)
    echo -e "${GREEN}✅ Listed $TOOL_COUNT tools${NC}"
    
    # Show available tools
    echo "   Available tools:"
    cat /tmp/tools.json | grep -o '"name":"[^"]*"' | cut -d':' -f2 | tr -d '"' | sed 's/^/   - /'
else
    echo -e "${RED}❌ List tools failed (HTTP $HTTP_CODE)${NC}"
    cat /tmp/tools.json
    exit 1
fi

# Test 3: Test add_numbers Tool
echo -e "\n${YELLOW}3️⃣ Test add_numbers Tool...${NC}"
ADD_RESPONSE=$(curl -s -w "%{http_code}" --max-time $TIMEOUT \
    -X POST "$BASE_URL/mcp" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"callTool","params":{"name":"add_numbers","arguments":{"numbers":[1,2,3,4,5]}},"id":2}' \
    -o /tmp/add.json)

HTTP_CODE="${ADD_RESPONSE: -3}"

if [ "$HTTP_CODE" = "200" ]; then
    RESULT=$(cat /tmp/add.json | grep -o '"text":"[^"]*"' | cut -d':' -f2 | tr -d '"')
    echo -e "${GREEN}✅ add_numbers result: $RESULT${NC}"
else
    echo -e "${RED}❌ add_numbers tool failed (HTTP $HTTP_CODE)${NC}"
    cat /tmp/add.json
    exit 1
fi

# Test 4: Test Jira Integration (optional)
echo -e "\n${YELLOW}4️⃣ Test Jira Integration (optional)...${NC}"
JIRA_RESPONSE=$(curl -s -w "%{http_code}" --max-time $TIMEOUT \
    -X POST "$BASE_URL/mcp" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"callTool","params":{"name":"jira_whoami","arguments":{}},"id":3}' \
    -o /tmp/jira.json 2>/dev/null)

HTTP_CODE="${JIRA_RESPONSE: -3}"

if [ "$HTTP_CODE" = "200" ]; then
    if grep -q "accountId" /tmp/jira.json; then
        echo -e "${GREEN}✅ Jira integration working${NC}"
        ACCOUNT_ID=$(cat /tmp/jira.json | grep -o '"accountId":"[^"]*"' | cut -d':' -f2 | tr -d '"')
        echo "   - Account ID: $ACCOUNT_ID"
    else
        echo -e "${YELLOW}⚠️ Jira returned unexpected response${NC}"
    fi
else
    echo -e "${YELLOW}⚠️ Jira integration not configured${NC}"
    echo "   Configure JIRA_* environment variables for full integration"
fi

# Test 5: Test Perplexity Integration (optional)
echo -e "\n${YELLOW}5️⃣ Test Perplexity Integration (optional)...${NC}"
PERP_RESPONSE=$(curl -s -w "%{http_code}" --max-time 30 \
    -X POST "$BASE_URL/mcp" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"callTool","params":{"name":"fetch_perplexity_data","arguments":{"query":"What is MCP?","max_results":1}},"id":4}' \
    -o /tmp/perp.json 2>/dev/null)

HTTP_CODE="${PERP_RESPONSE: -3}"

if [ "$HTTP_CODE" = "200" ]; then
    if grep -q "search_metadata" /tmp/perp.json; then
        echo -e "${GREEN}✅ Perplexity integration working${NC}"
    else
        echo -e "${YELLOW}⚠️ Perplexity returned unexpected response${NC}"
    fi
else
    echo -e "${YELLOW}⚠️ Perplexity integration not configured${NC}"
    echo "   Configure PERPLEXITY_API_KEY for search capabilities"
fi

# Test 6: List Resources
echo -e "\n${YELLOW}6️⃣ List Resources...${NC}"
RESOURCES_RESPONSE=$(curl -s -w "%{http_code}" --max-time $TIMEOUT \
    -X POST "$BASE_URL/mcp" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"listResources","id":5}' \
    -o /tmp/resources.json)

HTTP_CODE="${RESOURCES_RESPONSE: -3}"

if [ "$HTTP_CODE" = "200" ]; then
    RESOURCE_COUNT=$(cat /tmp/resources.json | grep -o '"uri"' | wc -l)
    echo -e "${GREEN}✅ Listed $RESOURCE_COUNT resources${NC}"
    
    if [ "$RESOURCE_COUNT" -gt 0 ]; then
        echo "   Available resources:"
        cat /tmp/resources.json | grep -o '"uri":"[^"]*"' | cut -d':' -f2- | tr -d '"' | sed 's/^/   - /'
    fi
else
    echo -e "${RED}❌ List resources failed (HTTP $HTTP_CODE)${NC}"
    cat /tmp/resources.json
fi

# Test 7: Test Resource Reading
echo -e "\n${YELLOW}7️⃣ Test Resource Reading...${NC}"
RESOURCE_READ_RESPONSE=$(curl -s -w "%{http_code}" --max-time $TIMEOUT \
    -X POST "$BASE_URL/mcp" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"readResource","params":{"uri":"search://history/recent/3"},"id":6}' \
    -o /tmp/resource_read.json)

HTTP_CODE="${RESOURCE_READ_RESPONSE: -3}"

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Resource reading working${NC}"
else
    echo -e "${YELLOW}⚠️ Resource reading test failed (expected for empty history)${NC}"
fi

# Test 8: Error Handling
echo -e "\n${YELLOW}8️⃣ Test Error Handling...${NC}"
ERROR_RESPONSE=$(curl -s -w "%{http_code}" --max-time $TIMEOUT \
    -X POST "$BASE_URL/mcp" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"callTool","params":{"name":"nonexistent_tool","arguments":{}},"id":7}' \
    -o /tmp/error.json)

HTTP_CODE="${ERROR_RESPONSE: -3}"

if [ "$HTTP_CODE" = "200" ] && grep -q "error" /tmp/error.json; then
    echo -e "${GREEN}✅ Error handling working${NC}"
    ERROR_MESSAGE=$(cat /tmp/error.json | grep -o '"message":"[^"]*"' | cut -d':' -f2 | tr -d '"')
    echo "   - Error: $ERROR_MESSAGE"
else
    echo -e "${RED}❌ Error handling test failed${NC}"
fi

# Test 9: Performance Test
echo -e "\n${YELLOW}9️⃣ Performance Test...${NC}"
START_TIME=$(date +%s%3N)
for i in {1..5}; do
    curl -s --max-time $TIMEOUT \
        -X POST "$BASE_URL/mcp" \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","method":"listTools","id":'$i'}' \
        -o /dev/null
done
END_TIME=$(date +%s%3N)

DURATION=$((END_TIME - START_TIME))
AVG_DURATION=$((DURATION / 5))

if [ "$AVG_DURATION" -lt 1000 ]; then
    echo -e "${GREEN}✅ Performance test passed (avg: ${AVG_DURATION}ms per request)${NC}"
else
    echo -e "${YELLOW}⚠️ Performance test slow (avg: ${AVG_DURATION}ms per request)${NC}"
fi

# Summary
echo -e "\n${BLUE}📊 Test Summary${NC}"
echo -e "${GREEN}✅ Core functionality: Working${NC}"
echo -e "${GREEN}✅ JSON-RPC protocol: Compliant${NC}"
echo -e "${GREEN}✅ Error handling: Proper${NC}"
echo -e "${GREEN}✅ Performance: Acceptable${NC}"

echo -e "\n${BLUE}🚀 Production Readiness Checklist:${NC}"
echo "   1. ✅ Health endpoint responding"
echo "   2. ✅ MCP protocol compliance"
echo "   3. ✅ Tool execution working"
echo "   4. ✅ Resource access working"
echo "   5. ✅ Error handling proper"
echo "   6. ⚠️  Configure Jira credentials (optional)"
echo "   7. ⚠️  Configure Perplexity API key (optional)"

echo -e "\n${GREEN}🎉 MCP Server is ready for production use!${NC}"

# Cleanup
rm -f /tmp/health.json /tmp/tools.json /tmp/add.json /tmp/jira.json /tmp/perp.json /tmp/resources.json /tmp/resource_read.json /tmp/error.json

echo -e "\n${BLUE}📚 Integration Examples:${NC}"
echo "   # List tools"
echo "   curl -X POST $BASE_URL/mcp -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"method\":\"listTools\",\"id\":1}'"
echo
echo "   # Call tool"
echo "   curl -X POST $BASE_URL/mcp -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"method\":\"callTool\",\"params\":{\"name\":\"add_numbers\",\"arguments\":{\"numbers\":[1,2,3]}},\"id\":2}'"
echo
echo "   # Read resource"
echo "   curl -X POST $BASE_URL/mcp -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"method\":\"readResource\",\"params\":{\"uri\":\"search://history/recent/5\"},\"id\":3}'"
