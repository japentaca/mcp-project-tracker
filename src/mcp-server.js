#!/usr/bin/env node

import Database from './database.js';

class MCPServer {
  constructor() {
    this.db = new Database();
    this.inputBuffer = '';
    this.init();
  }

  async init() {
    // Wait for database to be ready
    await this.db.ready;
    this.setupMessageHandling();
  }

  setupMessageHandling() {
    process.stdin.on('data', async (chunk) => {
      try {
        // Accumulate chunks into buffer
        this.inputBuffer += chunk.toString();

        // Process complete lines (messages are newline-delimited)
        let newlineIndex;
        while ((newlineIndex = this.inputBuffer.indexOf('\n')) !== -1) {
          const line = this.inputBuffer.slice(0, newlineIndex).trim();
          this.inputBuffer = this.inputBuffer.slice(newlineIndex + 1);

          if (line) {
            const message = JSON.parse(line);
            const response = await this.handleMessage(message);
            this.sendResponse(response);
          }
        }
      } catch (error) {
        this.sendError(error.message, null);
      }
    });
  }

  async handleMessage(message) {
    const { method, params = {}, id } = message;

    switch (method) {
      case 'initialize':
        return this.handleInitialize(id);

      case 'tools/list':
        return this.handleToolsList(id);

      case 'tools/call':
        return await this.handleToolCall(params, id);

      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }

  handleInitialize(id) {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'mcp-project-tracker',
          version: '1.0.0'
        }
      }
    };
  }

  handleToolsList(id) {
    const tools = [
      {
        name: 'create_project',
        description: 'Create a new project',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Project name' },
            client: { type: 'string', description: 'Client name (optional)' },
            description: { type: 'string', description: 'Project description (optional)' }
          },
          required: ['name']
        }
      },
      {
        name: 'list_projects',
        description: 'List all projects with metadata and counts',
        inputSchema: {
          type: 'object',
          properties: {
            client: { type: 'string', description: 'Filter by client name (optional)' }
          }
        }
      },
      {
        name: 'add_task',
        description: 'Add a new task to a project',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'number', description: 'ID of the project' },
            description: { type: 'string', description: 'Task description' },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'critical'],
              description: 'Task priority'
            },
            category: { type: 'string', description: 'Task category (optional)' },
            assignee: { type: 'string', description: 'Task assignee (optional)' },
            due_date: { type: 'string', description: 'Due date (YYYY-MM-DD, optional)' }
          },
          required: ['project_id', 'description']
        }
      },
      {
        name: 'update_task',
        description: 'Update an existing task',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'Task ID' },
            status: {
              type: 'string',
              enum: ['pending', 'in-progress', 'developed', 'tested', 'deployed', 'blocked'],
              description: 'Task status'
            },
            notes: { type: 'string', description: 'Task notes (optional)' },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'critical'],
              description: 'Task priority (optional)'
            },
            category: { type: 'string', description: 'Task category (optional)' },
            description: { type: 'string', description: 'Task description (optional)' },
            assignee: { type: 'string', description: 'Task assignee (optional)' },
            due_date: { type: 'string', description: 'Due date (YYYY-MM-DD, optional)' }
          },
          required: ['id']
        }
      },
      {
        name: 'get_tasks',
        description: 'Get filtered tasks',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'number', description: 'Filter by project ID (optional)' },
            status: {
              type: 'string',
              enum: ['pending', 'in-progress', 'developed', 'tested', 'deployed', 'blocked'],
              description: 'Filter by status (optional)'
            },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'critical'],
              description: 'Filter by priority (optional)'
            },
            category: { type: 'string', description: 'Filter by category (optional)' },
            assignee: { type: 'string', description: 'Filter by assignee (optional)' },
            search: { type: 'string', description: 'Search in description and notes (optional)' }
          }
        }
      },
      {
        name: 'get_project_summary',
        description: 'Get summary statistics for a project',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'number', description: 'Project ID' }
          },
          required: ['project_id']
        }
      },
      {
        name: 'delete_task',
        description: 'Delete a task',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'Task ID to delete' }
          },
          required: ['id']
        }
      },
      {
        name: 'delete_project',
        description: 'Delete a project and all its tasks',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'Project ID to delete' }
          },
          required: ['id']
        }
      }
    ];

    return {
      jsonrpc: '2.0',
      id,
      result: { tools }
    };
  }

  async handleToolCall(params, id) {
    const { name, arguments: args } = params;

    try {
      let result;

      switch (name) {
        case 'create_project':
          result = await this.createProject(args);
          break;

        case 'list_projects':
          result = await this.listProjects(args);
          break;

        case 'add_task':
          result = await this.addTask(args);
          break;

        case 'update_task':
          result = await this.updateTask(args);
          break;

        case 'get_tasks':
          result = await this.getTasks(args);
          break;

        case 'get_project_summary':
          result = await this.getProjectSummary(args);
          break;

        case 'delete_task':
          result = await this.deleteTask(args);
          break;

        case 'delete_project':
          result = await this.deleteProject(args);
          break;

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        }
      };

    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32000,
          message: error.message
        }
      };
    }
  }

  // Input validation helpers
  validateStatus(status) {
    const validStatuses = ['pending', 'in-progress', 'developed', 'tested', 'deployed', 'blocked'];
    if (status && !validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
    }
  }

  validatePriority(priority) {
    const validPriorities = ['low', 'medium', 'high', 'critical'];
    if (priority && !validPriorities.includes(priority)) {
      throw new Error(`Invalid priority: ${priority}. Must be one of: ${validPriorities.join(', ')}`);
    }
  }

  validateId(id, fieldName = 'ID') {
    if (typeof id !== 'number' || id <= 0 || !Number.isInteger(id)) {
      throw new Error(`Invalid ${fieldName}: must be a positive integer`);
    }
  }

  validateString(value, fieldName, required = true) {
    if (required && (!value || typeof value !== 'string' || value.trim() === '')) {
      throw new Error(`${fieldName} is required and must be a non-empty string`);
    }
    if (!required && value !== undefined && value !== null && typeof value !== 'string') {
      throw new Error(`${fieldName} must be a string`);
    }
  }

  // Tool implementations
  async createProject(args) {
    const { name, client, description } = args;

    // Validate inputs
    this.validateString(name, 'Name', true);
    this.validateString(client, 'Client', false);
    this.validateString(description, 'Description', false);

    const id = await this.db.createProject(name, client, description);
    return {
      success: true,
      project_id: id,
      message: `Project "${name}" created with ID ${id}`
    };
  }

  async listProjects(args) {
    const { client } = args;

    // Validate inputs
    this.validateString(client, 'Client', false);

    const projects = await this.db.getProjects(client);
    return { projects };
  }

  async addTask(args) {
    const { project_id, description, priority = 'medium', category, assignee, due_date } = args;

    // Validate inputs
    this.validateId(project_id, 'Project ID');
    this.validateString(description, 'Description', true);
    this.validatePriority(priority);
    this.validateString(category, 'Category', false);
    this.validateString(assignee, 'Assignee', false);
    this.validateString(due_date, 'Due date', false);

    // Verify project exists
    const project = await this.db.getProject(project_id);
    if (!project) {
      throw new Error(`Project with ID ${project_id} not found`);
    }

    const id = await this.db.addTask(project_id, description, priority, category, assignee, due_date);
    return {
      success: true,
      task_id: id,
      message: `Task added with ID ${id} to project "${project.name}"`
    };
  }

  async updateTask(args) {
    const { id, status, notes, priority, category, description, assignee, due_date } = args;

    // Validate inputs
    this.validateId(id, 'Case ID');
    this.validateStatus(status);
    this.validatePriority(priority);
    this.validateString(notes, 'Notes', false);
    this.validateString(category, 'Category', false);
    this.validateString(description, 'Description', false);
    this.validateString(assignee, 'Assignee', false);
    this.validateString(due_date, 'Due date', false);

    const updates = {};
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = notes;
    if (priority !== undefined) updates.priority = priority;
    if (category !== undefined) updates.category = category;
    if (description !== undefined) updates.description = description;
    if (assignee !== undefined) updates.assignee = assignee;
    if (due_date !== undefined) updates.due_date = due_date;

    const success = await this.db.updateTask(id, updates);

    if (!success) {
      throw new Error(`Task with ID ${id} not found`);
    }

    return {
      success: true,
      message: `Task ${id} updated successfully`
    };
  }

  async getTasks(args) {
    const { project_id, status, priority, category, assignee, search } = args;

    // Validate inputs
    if (project_id !== undefined) this.validateId(project_id, 'Project ID');
    this.validateStatus(status);
    this.validatePriority(priority);
    this.validateString(category, 'Category', false);
    this.validateString(assignee, 'Assignee', false);
    this.validateString(search, 'Search', false);

    const tasks = await this.db.getTasks(args);
    return { tasks };
  }

  async getProjectSummary(args) {
    const { project_id } = args;

    // Validate inputs
    this.validateId(project_id, 'Project ID');

    // Verify project exists
    const project = await this.db.getProject(project_id);
    if (!project) {
      throw new Error(`Project with ID ${project_id} not found`);
    }

    const summary = await this.db.getProjectSummary(project_id);
    return {
      project_name: project.name,
      project_id,
      summary
    };
  }

  async deleteTask(args) {
    const { id } = args;

    // Validate inputs
    this.validateId(id, 'Task ID');

    const success = await this.db.deleteTask(id);

    if (!success) {
      throw new Error(`Task with ID ${id} not found`);
    }

    return {
      success: true,
      message: `Task ${id} deleted successfully`
    };
  }

  async deleteProject(args) {
    const { id } = args;

    // Validate inputs
    this.validateId(id, 'Project ID');

    // Verify project exists
    const project = await this.db.getProject(id);
    if (!project) {
      throw new Error(`Project with ID ${id} not found`);
    }

    const success = await this.db.deleteProject(id);
    return {
      success: true,
      message: `Project "${project.name}" and all its tasks deleted successfully`
    };
  }

  sendResponse(response) {
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  sendError(message, id = null) {
    const error = {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32000,
        message
      }
    };
    process.stdout.write(JSON.stringify(error) + '\n');
  }
}

// Handle process termination
let server;

process.on('SIGINT', async () => {
  console.error('Shutting down MCP server...');
  if (server && server.db) {
    await server.db.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.error('Shutting down MCP server...');
  if (server && server.db) {
    await server.db.close();
  }
  process.exit(0);
});

// Start the MCP server
server = new MCPServer();
console.error('MCP Project Tracker Server started');