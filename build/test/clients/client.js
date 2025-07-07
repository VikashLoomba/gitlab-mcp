/**
 * MCP Client Interface and error classes for testing
 */
/**
 * Base error class for MCP client errors
 */
export class MCPClientError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = 'MCPClientError';
    }
}
/**
 * Connection error for MCP clients
 */
export class MCPConnectionError extends MCPClientError {
    constructor(message, cause) {
        super(message, cause);
        this.name = 'MCPConnectionError';
    }
}
/**
 * Tool call error for MCP clients
 */
export class MCPToolCallError extends MCPClientError {
    toolName;
    constructor(message, toolName, cause) {
        super(message, cause);
        this.toolName = toolName;
        this.name = 'MCPToolCallError';
    }
}
