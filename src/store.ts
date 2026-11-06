import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ApiRequest, Collection, EnvFile, HistoryEntry } from './types';
import { newRequestTemplate, normalizeRequest } from './model';

export const GLOBAL_ENV = '@global';
const HISTORY_KEY = 'apiRequest.history';
const HISTORY_MAX = 50;

/**
 * Guarda los datos en archivos JSON.
 *  - Con carpeta abierta:  <proyecto>/.api-request/collections.json  (se puede subir a git)
 *                          <proyecto>/.api-request/environments.json (ignóralo en git si tiene secretos)
 *  - Sin carpeta abierta:  almacenamiento global de la extensión.
 * El historial se guarda en el estado global de VS Code (no va al proyecto).
 */
export class Store {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private collections: Collection[] = [];
  private env: EnvFile = { activeEnv: '', environments: {}, globals: {} };

  constructor(private readonly context: vscode.ExtensionContext) {
    this.load();
    context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.reload()),
      vscode.workspace.onDidSaveTextDocument((doc) => {
        const p = path.normalize(doc.uri.fsPath);
        if (p === path.normalize(this.envPath()) || p === path.normalize(this.collectionsPath())) {
          this.reload();
        }
      })
    );
  }

  // ---------- rutas ----------
  private dir(): string {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder
      ? path.join(folder.uri.fsPath, '.api-request')
      : this.context.globalStorageUri.fsPath;
  }
  collectionsPath(): string {
    return path.join(this.dir(), 'collections.json');
  }
  envPath(): string {
    return path.join(this.dir(), 'environments.json');
  }

  // ---------- carga / guardado ----------
  private readJson<T>(file: string, fallback: T): T {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as T;
    } catch {
      return fallback;
    }
  }
  private writeJson(file: string, data: unknown) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  }
  private load() {
    const cols = this.readJson<Collection[]>(this.collectionsPath(), []);
    this.collections = (Array.isArray(cols) ? cols : []).map((c) => ({
      ...c,
      requests: (c.requests || []).map(normalizeRequest),
    }));
    const env = this.readJson<Partial<EnvFile>>(this.envPath(), {});
    this.env = {
      activeEnv: env.activeEnv || '',
      environments: env.environments || {},
      globals: env.globals || {},
    };
  }
  reload() {
    this.load();
    this._onDidChange.fire();
  }
  private saveCollections() {
    this.writeJson(this.collectionsPath(), this.collections);
    this._onDidChange.fire();
  }
  private saveEnv() {
    this.writeJson(this.envPath(), this.env);
    this._onDidChange.fire();
  }

  // ---------- colecciones ----------
  getCollections(): Collection[] {
    return this.collections;
  }
  getCollection(id: string): Collection | undefined {
    return this.collections.find((c) => c.id === id);
  }
  addCollection(name: string, requests: ApiRequest[] = []): Collection {
    const c: Collection = { id: randomUUID(), name, requests };
    this.collections.push(c);
    this.saveCollections();
    return c;
  }
  renameCollection(id: string, name: string) {
    const c = this.getCollection(id);
    if (c) {
      c.name = name;
      this.saveCollections();
    }
  }
  deleteCollection(id: string) {
    this.collections = this.collections.filter((c) => c.id !== id);
    this.saveCollections();
  }

  // ---------- peticiones ----------
  getRequest(collId: string, reqId: string): ApiRequest | undefined {
    return this.getCollection(collId)?.requests.find((r) => r.id === reqId);
  }
  addRequest(collId: string, name: string, base?: ApiRequest): ApiRequest | undefined {
    const c = this.getCollection(collId);
    if (!c) {
      return undefined;
    }
    const r: ApiRequest = base
      ? { ...(JSON.parse(JSON.stringify(base)) as ApiRequest), id: randomUUID(), name }
      : newRequestTemplate(name);
    c.requests.push(r);
    this.saveCollections();
    return r;
  }
  updateRequest(collId: string, req: ApiRequest) {
    const c = this.getCollection(collId);
    if (!c) {
      return;
    }
    const i = c.requests.findIndex((r) => r.id === req.id);
    if (i >= 0) {
      c.requests[i] = normalizeRequest(req);
      this.saveCollections();
    }
  }
  duplicateRequest(collId: string, reqId: string): ApiRequest | undefined {
    const c = this.getCollection(collId);
    const r = this.getRequest(collId, reqId);
    if (!c || !r) {
      return undefined;
    }
    const copy: ApiRequest = JSON.parse(JSON.stringify(r));
    copy.id = randomUUID();
    copy.name = r.name + ' (copia)';
    c.requests.splice(c.requests.indexOf(r) + 1, 0, copy);
    this.saveCollections();
    return copy;
  }
  deleteRequest(collId: string, reqId: string) {
    const c = this.getCollection(collId);
    if (c) {
      c.requests = c.requests.filter((r) => r.id !== reqId);
      this.saveCollections();
    }
  }

  // ---------- entornos y variables ----------
  envNames(): string[] {
    return Object.keys(this.env.environments);
  }
  get activeEnv(): string {
    return this.env.environments[this.env.activeEnv] ? this.env.activeEnv : '';
  }
  setActiveEnv(name: string) {
    this.env.activeEnv = name;
    this.saveEnv();
  }
  createEnv(name: string) {
    if (!this.env.environments[name]) {
      this.env.environments[name] = {};
    }
    this.env.activeEnv = name;
    this.saveEnv();
  }
  deleteEnv(name: string) {
    delete this.env.environments[name];
    if (this.env.activeEnv === name) {
      this.env.activeEnv = '';
    }
    this.saveEnv();
  }
  getEnvVars(name: string): Record<string, string> {
    return name === GLOBAL_ENV ? this.env.globals : this.env.environments[name] || {};
  }
  setEnvVar(envName: string, key: string, value: string) {
    const target = envName === GLOBAL_ENV ? this.env.globals : this.env.environments[envName];
    if (target) {
      target[key] = value;
      this.saveEnv();
    }
  }
  deleteEnvVar(envName: string, key: string) {
    const target = envName === GLOBAL_ENV ? this.env.globals : this.env.environments[envName];
    if (target) {
      delete target[key];
      this.saveEnv();
    }
  }
  /** Variables efectivas: globales + entorno activo (el entorno gana). */
  allVars(): Record<string, string> {
    return { ...this.env.globals, ...(this.env.environments[this.activeEnv] || {}) };
  }
  /** Usado por "Set Env Variable" y por tc.setVar. value === null borra. */
  setVar(name: string, value: string | null, scope: 'active' | 'global') {
    const useActive = scope === 'active' && this.activeEnv;
    const target = useActive ? this.env.environments[this.activeEnv] : this.env.globals;
    if (value === null) {
      delete target[name];
    } else {
      target[name] = value;
    }
    this.saveEnv();
  }
  /** Asegura que el archivo de entornos exista y devuelve su ruta. */
  ensureEnvFile(): string {
    if (!fs.existsSync(this.envPath())) {
      if (this.envNames().length === 0) {
        this.env = {
          activeEnv: 'local',
          environments: { local: { baseUrl: 'http://localhost:3000' } },
          globals: {},
        };
      }
      this.saveEnv();
    }
    return this.envPath();
  }

  // ---------- historial ----------
  getHistory(): HistoryEntry[] {
    return this.context.globalState.get<HistoryEntry[]>(HISTORY_KEY, []);
  }
  async addHistory(request: ApiRequest, status: number, timeMs: number) {
    const list = this.getHistory();
    list.unshift({
      id: randomUUID(),
      at: Date.now(),
      status,
      timeMs,
      request: JSON.parse(JSON.stringify(request)),
    });
    await this.context.globalState.update(HISTORY_KEY, list.slice(0, HISTORY_MAX));
    this._onDidChange.fire();
  }
  async clearHistory() {
    await this.context.globalState.update(HISTORY_KEY, []);
    this._onDidChange.fire();
  }
}
