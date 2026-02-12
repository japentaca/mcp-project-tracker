import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import config from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isTestMode = process.env.NODE_ENV === 'test';

class Database {
  constructor(dbPath = config.database.path) {
    this.dbPath = dbPath;
    this.db = null;
    this.ready = this.init();
  }

  async init() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, async (err) => {
        if (err) {
          console.error('Error opening database:', err.message);
          reject(err);
          return;
        }
        if (!isTestMode) console.log('Connected to SQLite database');

        try {
          // Enable foreign keys
          await this.run('PRAGMA foreign_keys = ON');
          if (!isTestMode) console.log('Foreign keys enabled');

          // Enable WAL mode for better concurrency
          await this.run('PRAGMA journal_mode = WAL');
          if (!isTestMode) console.log('WAL mode enabled');

          // Load and execute schema
          const schemaPath = join(__dirname, 'schema.sql');
          const schema = readFileSync(schemaPath, 'utf8');

          this.db.exec(schema, (err) => {
            if (err) {
              console.error('Error creating schema:', err.message);
              reject(err);
              return;
            }
            if (!isTestMode) console.log('Database schema initialized');
            resolve();
          });
        } catch (error) {
          console.error('Error during database initialization:', error.message);
          reject(error);
        }
      });
    });
  }

  // Promisify database operations
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, changes: this.changes });
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // Project operations (formerly test_suites)
  async createProject(name, client = null, description = null) {
    const sql = `
      INSERT INTO projects (name, client, description, updated_at) 
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `;
    const result = await this.run(sql, [name, client, description]);
    return result.id;
  }

  async getProjects(client = null) {
    let sql = `
      SELECT p.*, 
             COUNT(t.id) as total_tasks,
             COUNT(CASE WHEN t.status = 'pending' THEN 1 END) as pending_tasks,
             COUNT(CASE WHEN t.status = 'in-progress' THEN 1 END) as in_progress_tasks,
             COUNT(CASE WHEN t.status = 'developed' THEN 1 END) as developed_tasks,
             COUNT(CASE WHEN t.status = 'tested' THEN 1 END) as tested_tasks,
             COUNT(CASE WHEN t.status = 'deployed' THEN 1 END) as deployed_tasks,
             COUNT(CASE WHEN t.status = 'blocked' THEN 1 END) as blocked_tasks
      FROM projects p 
      LEFT JOIN tasks t ON p.id = t.project_id
    `;

    const params = [];
    if (client) {
      sql += ' WHERE p.client = ?';
      params.push(client);
    }

    sql += ' GROUP BY p.id ORDER BY p.updated_at DESC';

    return await this.all(sql, params);
  }

  async getProject(id) {
    const sql = 'SELECT * FROM projects WHERE id = ?';
    return await this.get(sql, [id]);
  }

  async updateProject(id, updates = {}) {
    const allowedFields = ['name', 'client', 'description'];
    const setClause = [];
    const params = [];

    for (const [field, value] of Object.entries(updates)) {
      if (allowedFields.includes(field)) {
        setClause.push(`${field} = ?`);
        params.push(value);
      }
    }

    if (setClause.length === 0) {
      throw new Error('No valid fields to update');
    }

    setClause.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    const sql = `UPDATE projects SET ${setClause.join(', ')} WHERE id = ?`;
    const result = await this.run(sql, params);
    return result.changes > 0;
  }

  async deleteProject(id) {
    const sql = 'DELETE FROM projects WHERE id = ?';
    const result = await this.run(sql, [id]);
    return result.changes > 0;
  }

  // Task operations (formerly test_cases)
  async addTask(projectId, description, priority = 'medium', category = null, assignee = null, dueDate = null) {
    const sql = `
      INSERT INTO tasks (project_id, description, priority, category, assignee, due_date, updated_at) 
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;
    const result = await this.run(sql, [projectId, description, priority, category, assignee, dueDate]);

    // Update project timestamp
    await this.run('UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [projectId]);

    return result.id;
  }

  async updateTask(id, updates = {}) {
    const allowedFields = ['status', 'notes', 'priority', 'category', 'description', 'assignee', 'due_date'];
    const setClause = [];
    const params = [];

    for (const [field, value] of Object.entries(updates)) {
      if (allowedFields.includes(field)) {
        setClause.push(`${field} = ?`);
        params.push(value);
      }
    }

    if (setClause.length === 0) {
      throw new Error('No valid fields to update');
    }

    setClause.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    const sql = `UPDATE tasks SET ${setClause.join(', ')} WHERE id = ?`;
    const result = await this.run(sql, params);

    // Update project timestamp
    const task = await this.get('SELECT project_id FROM tasks WHERE id = ?', [id]);
    if (task) {
      await this.run('UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [task.project_id]);
    }

    return result.changes > 0;
  }

  async getTasks(filters = {}) {
    let sql = 'SELECT * FROM tasks WHERE 1=1';
    const params = [];

    if (filters.project_id) {
      sql += ' AND project_id = ?';
      params.push(filters.project_id);
    }

    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.priority) {
      sql += ' AND priority = ?';
      params.push(filters.priority);
    }

    if (filters.category) {
      sql += ' AND category = ?';
      params.push(filters.category);
    }

    if (filters.assignee) {
      sql += ' AND assignee = ?';
      params.push(filters.assignee);
    }

    if (filters.search) {
      sql += ' AND (description LIKE ? OR notes LIKE ?)';
      const searchTerm = `%${filters.search}%`;
      params.push(searchTerm, searchTerm);
    }

    sql += ' ORDER BY created_at DESC';

    return await this.all(sql, params);
  }

  async deleteTask(id) {
    // Get project_id before deletion
    const task = await this.get('SELECT project_id FROM tasks WHERE id = ?', [id]);

    const sql = 'DELETE FROM tasks WHERE id = ?';
    const result = await this.run(sql, [id]);

    // Update project timestamp if task was deleted
    if (result.changes > 0 && task) {
      await this.run('UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [task.project_id]);
    }

    return result.changes > 0;
  }

  async getProjectSummary(projectId) {
    const sql = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'in-progress' THEN 1 END) as in_progress,
        COUNT(CASE WHEN status = 'developed' THEN 1 END) as developed,
        COUNT(CASE WHEN status = 'tested' THEN 1 END) as tested,
        COUNT(CASE WHEN status = 'deployed' THEN 1 END) as deployed,
        COUNT(CASE WHEN status = 'blocked' THEN 1 END) as blocked,
        COUNT(CASE WHEN priority = 'critical' THEN 1 END) as critical,
        COUNT(CASE WHEN priority = 'high' THEN 1 END) as high,
        COUNT(CASE WHEN priority = 'medium' THEN 1 END) as medium,
        COUNT(CASE WHEN priority = 'low' THEN 1 END) as low
      FROM tasks 
      WHERE project_id = ?
    `;

    const summary = await this.get(sql, [projectId]);

    // Calculate completion percentage (deployed = completed)
    summary.completion_percentage = summary.total > 0 ? Math.round((summary.deployed / summary.total) * 100) : 0;
    summary.progress_percentage = summary.total > 0 ? Math.round(((summary.developed + summary.tested + summary.deployed) / summary.total) * 100) : 0;

    return summary;
  }

  // Get unique assignees for filtering
  async getAssignees(projectId = null) {
    let sql = 'SELECT DISTINCT assignee FROM tasks WHERE assignee IS NOT NULL AND assignee != ""';
    const params = [];

    if (projectId) {
      sql += ' AND project_id = ?';
      params.push(projectId);
    }

    sql += ' ORDER BY assignee';

    const rows = await this.all(sql, params);
    return rows.map(row => row.assignee);
  }

  close() {
    return new Promise((resolve) => {
      this.db.close((err) => {
        if (err) {
          console.error('Error closing database:', err.message);
        }
        console.log('Database connection closed');
        resolve();
      });
    });
  }
}

export default Database;