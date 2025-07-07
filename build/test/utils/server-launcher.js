/**
 * Server launcher utility for testing different transport modes
 * Manages server processes and provides clean shutdown
 */
import { spawn } from 'child_process';
import * as path from 'path';
export const HOST = process.env.HOST || '127.0.0.1';
export var TransportMode;
(function (TransportMode) {
    TransportMode["STDIO"] = "stdio";
    TransportMode["SSE"] = "sse";
    TransportMode["STREAMABLE_HTTP"] = "streamable-http";
})(TransportMode || (TransportMode = {}));
/**
 * Launch a server with specified configuration
 */
export async function launchServer(config) {
    const { mode, port = 3002, env = {}, timeout = 3000 } = config;
    // Prepare environment variables based on transport mode
    // Use same configuration pattern as existing validate-api.js
    const GITLAB_API_URL = process.env.GITLAB_API_URL || "https://gitlab.com";
    const GITLAB_TOKEN = process.env.GITLAB_TOKEN_TEST || process.env.GITLAB_TOKEN;
    const TEST_PROJECT_ID = process.env.TEST_PROJECT_ID;
    // Validate that we have required configuration
    if (!GITLAB_TOKEN) {
        throw new Error('GITLAB_TOKEN_TEST or GITLAB_TOKEN environment variable is required for server testing');
    }
    if (!TEST_PROJECT_ID) {
        throw new Error('TEST_PROJECT_ID environment variable is required for server testing');
    }
    const serverEnv = {
        // Add all environment variables from the current process
        ...process.env,
        GITLAB_API_URL: `${GITLAB_API_URL}/api/v4`,
        GITLAB_PROJECT_ID: TEST_PROJECT_ID,
        GITLAB_READ_ONLY_MODE: 'true', // Use read-only mode for testing
        ...env,
    };
    // Set transport-specific environment variables
    switch (mode) {
        case TransportMode.SSE:
            serverEnv.SSE = 'true';
            serverEnv.PORT = port.toString();
            break;
        case TransportMode.STREAMABLE_HTTP:
            serverEnv.STREAMABLE_HTTP = 'true';
            serverEnv.PORT = port.toString();
            break;
        case TransportMode.STDIO:
            // Stdio mode doesn't need port configuration - uses process communication
            throw new Error(`${TransportMode.STDIO} mode is not supported for server testing, because it uses process communication.`);
    }
    const serverPath = path.resolve(process.cwd(), 'build/index.js');
    const serverProcess = spawn('node', [serverPath], {
        env: serverEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false
    });
    // Wait for server to start
    await waitForServerStart(serverProcess, mode, port, timeout);
    const instance = {
        process: serverProcess,
        port: port,
        mode,
        kill: () => {
            if (!serverProcess.killed) {
                serverProcess.kill('SIGTERM');
                // Force kill if not terminated within 5 seconds
                setTimeout(() => {
                    if (!serverProcess.killed) {
                        serverProcess.kill('SIGKILL');
                    }
                }, 5000);
            }
        }
    };
    return instance;
}
/**
 * Wait for server to start based on transport mode
 */
async function waitForServerStart(process, mode, port, timeout) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Server failed to start within ${timeout}ms for mode ${mode}`));
        }, timeout);
        let outputBuffer = '';
        const onData = (data) => {
            const output = data.toString();
            outputBuffer += output;
            // Check for server start messages
            const startMessages = [
                'Starting GitLab MCP Server with stdio transport',
                'Starting GitLab MCP Server with SSE transport',
                'Starting GitLab MCP Server with Streamable HTTP transport',
                'GitLab MCP Server running',
                `port ${port}`
            ];
            const hasStartMessage = startMessages.some(msg => outputBuffer.includes(msg));
            if (hasStartMessage) {
                clearTimeout(timer);
                process.stdout?.removeListener('data', onData);
                process.stderr?.removeListener('data', onData);
                // Additional wait for HTTP servers to be fully ready
                if (mode !== TransportMode.STDIO) {
                    setTimeout(resolve, 1000);
                }
                else {
                    resolve();
                }
            }
        };
        const onError = (error) => {
            clearTimeout(timer);
            reject(new Error(`Server process error: ${error.message}`));
        };
        const onExit = (code) => {
            clearTimeout(timer);
            reject(new Error(`Server process exited with code ${code} before starting`));
        };
        process.stdout?.on('data', onData);
        process.stderr?.on('data', onData);
        process.on('error', onError);
        process.on('exit', onExit);
    });
}
/**
 * Find an available port starting from a base port
 */
export async function findAvailablePort(basePort = 3002) {
    const net = await import('net');
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(basePort, () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : basePort;
            server.close(() => resolve(port));
        });
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                // Port is in use, try next one
                resolve(findAvailablePort(basePort + 1));
            }
            else {
                reject(err);
            }
        });
    });
}
/**
 * Clean shutdown for multiple server instances
 */
export function cleanupServers(servers) {
    servers.forEach(server => {
        try {
            server.kill();
        }
        catch (error) {
            console.warn(`Failed to kill server process: ${error}`);
        }
    });
}
/**
 * Create AbortController with timeout
 */
export function createTimeoutController(timeout) {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), timeout);
    return controller;
}
/**
 * Check if a health endpoint is responding
 */
export async function checkHealthEndpoint(port, maxRetries = 5) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const controller = createTimeoutController(5000);
            const response = await fetch(`http://${HOST}:${port}/health`, {
                method: 'GET',
                signal: controller.signal
            });
            if (response.ok) {
                const healthData = await response.json();
                return healthData;
            }
            else {
                throw new Error(`Health check failed with status ${response.status}`);
            }
        }
        catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                lastError = new Error('Request timeout after 5000ms');
            }
            else {
                lastError = error instanceof Error ? error : new Error(String(error));
            }
            if (i < maxRetries - 1) {
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }
    throw lastError;
}
