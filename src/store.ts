import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ApiRequest, Collection, Container, EnvFile, Folder, HistoryEntry } from './types';
import { CookieJar, StoredCookie } from './cookiejar';
import { newRequestTemplate, normalizeCollection, normalizeRequest } from './model';

export const GLOBAL_ENV = '@global';
const HISTORY_KEY = 'apiRequest.history';
const HISTORY_MAX = 50;
const BACKUP_FILE = 'collections.backup.json';
const GITIGNORE_ENTRIES = ['environments.json', 'cookies.json', BACKUP_FILE];
const GITIGNORE_HEADER =
  '# Creado por Ramcrack Request: lo que puede llevar tokens o contraseñas no se sube a git.\n' +
  '# collections.json sí se puede versionar (usa {{variables}} en vez de secretos escritos a mano).\n';

/** Una colección o carpeta, con su ruta legible (para selectores "Mover a…" o "Guardar en…"). */
export interface ContainerRef {
  collectionId: string;
  /** id de la colección o de la carpeta */
  containerId: string;
  /** "Colección / Carpeta / Subcarpeta" */
  label: string;
  depth: number;
}

// ---------------------------------------------------------------------------
//  Ayudas para recorrer el árbol colección → carpetas → peticiones
// ---------------------------------------------------------------------------
function* walk(root: Container): Generator<Container> {
  yield root;
  for (const f of root.folders) {
    yield* walk(f);
  }
}

function findContainer(coll: Collection, id: string): Container | undefined {
  for (const c of walk(coll)) {
    if (c.id === id) {
      return c;
    }
  }
  return undefined;
}

function findRequestLoc(coll: Collection, reqId: string) {
  for (const c of walk(coll)) {
    const index = c.requests.findIndex((r) => r.id === reqId);
    if (index >= 0) {
      return { container: c, index, request: c.requests[index] };
    }
  }
  return undefined;
}

function findFolderLoc(coll: Collection, folderId: string) {
  for (const c of walk(coll)) {
    const index = c.folders.findIndex((f) => f.id === folderId);
    if (index >= 0) {
      return { parent: c, index, folder: c.folders[index] };
    }
  }
  return undefined;
}

/** Inserta en `index` (posición final); sin índice o fuera de rango, al final. */
function insertAt<T>(list: T[], item: T, index?: number) {
  if (index === undefined || index >= list.length) {
    list.push(item);
  } else {
    list.splice(Math.max(0, index), 0, item);
  }
}

function cloneRequest(r: ApiRequest): ApiRequest {
  const copy: ApiRequest = JSON.parse(JSON.stringify(r));
  copy.id = randomUUID();
  return copy;
}

/** Copia profunda: TODAS las ids (carpetas y peticiones) son nuevas. */
function cloneFolder(f: Folder): Folder {
  return {
    id: randomUUID(),
    name: f.name,
    requests: f.requests.map(cloneRequest),
    folders: f.folders.map(cloneFolder),
  };
}

/**
 * Guarda los datos en archivos JSON.
 *  - Con carpeta abierta:  <proyecto>/.api-request/collections.json  (se puede subir a git)
 *                          <proyecto>/.api-request/environments.json (ignóralo en git si tiene secretos)
 *  - Sin carpeta abierta:  almacenamiento global de la extensión.
 * El historial se guarda en el estado global de VS Code (no va al proyecto).
 *
 * Las colecciones pueden tener carpetas anidadas. Las peticiones se localizan por id en todo el
 * árbol de su colección, así que quien llama solo necesita (colección, petición).
 */
export class Store {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private collections: Collection[] = [];
  private env: EnvFile = { activeEnv: '', environments: {}, globals: {} };
  /** true si collections.json es del formato de la 0.2.x (sin `folders`) y aún no se respaldó. */
  private legacyFormat = false;

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
  backupPath(): string {
    return path.join(this.dir(), BACKUP_FILE);
  }
  envPath(): string {
    return path.join(this.dir(), 'environments.json');
  }
  cookiesPath(): string {
    return path.join(this.dir(), 'cookies.json');
  }

  // ---------- cookies ----------
  private jar?: CookieJar;
  /** Almacén de cookies del proyecto (se carga de cookies.json la primera vez que se pide). */
  getCookieJar(): CookieJar {
    if (!this.jar) {
      this.jar = new CookieJar(this.readJson<StoredCookie[]>(this.cookiesPath(), []));
    }
    return this.jar;
  }
  /** Guarda las cookies en disco (no avisa a las vistas: no cambian el árbol). */
  saveCookies() {
    if (this.jar) {
      this.writeJson(this.cookiesPath(), this.jar);
    }
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
    this.ensureGitignore();
  }
  /** true si los datos viven en el proyecto (.api-request/), false si están en el almacenamiento global. */
  inWorkspace(): boolean {
    return Boolean(vscode.workspace.workspaceFolders?.[0]);
  }
  /**
   * Crea (o completa) .api-request/.gitignore para que lo sensible no se suba a git por descuido:
   * los entornos (variables y tokens guardados), las cookies y la copia de seguridad (trae lo mismo
   * que collections.json). collections.json se deja versionable. Nunca borra líneas del usuario.
   */
  private ensureGitignore() {
    if (!this.inWorkspace()) {
      return;
    }
    try {
      const file = path.join(this.dir(), '.gitignore');
      const wanted = GITIGNORE_ENTRIES;
      if (!fs.existsSync(file)) {
        fs.writeFileSync(file, GITIGNORE_HEADER + wanted.join('\n') + '\n', 'utf8');
        return;
      }
      const current = fs.readFileSync(file, 'utf8');
      const lines = new Set(current.split(/\r?\n/).map((l) => l.trim()));
      const missing = wanted.filter((w) => !lines.has(w));
      if (missing.length) {
        const sep = current.endsWith('\n') || current === '' ? '' : '\n';
        fs.appendFileSync(file, sep + missing.join('\n') + '\n', 'utf8');
      }
    } catch {
      /* si no se puede escribir el .gitignore, no se bloquea el guardado */
    }
  }
  private load() {
    const raw = this.readJson<unknown>(this.collectionsPath(), []);
    const list: any[] = Array.isArray(raw) ? raw : [];
    // Formato de la 0.2.x: alguna colección no trae `folders`. Se respalda antes del primer guardado.
    this.legacyFormat = list.some((c) => !Array.isArray(c?.folders));
    this.collections = list.map(normalizeCollection);
    this.jar = undefined; // se vuelve a leer cookies.json del proyecto actual
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
  /** Copia collections.json a collections.backup.json, una sola vez, antes de migrarlo. */
  private backupLegacyOnce() {
    if (!this.legacyFormat) {
      return;
    }
    this.legacyFormat = false;
    try {
      const src = this.collectionsPath();
      const dst = this.backupPath();
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.copyFileSync(src, dst);
      }
    } catch {
      /* si no se puede respaldar, no se bloquea el guardado */
    }
  }
  private saveCollections() {
    this.backupLegacyOnce();
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
  addCollection(name: string, requests: ApiRequest[] = [], folders: Folder[] = []): Collection {
    const c: Collection = { id: randomUUID(), name, requests, folders };
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

  /** Todas las colecciones y carpetas con su ruta legible, en orden de árbol. */
  listContainers(): ContainerRef[] {
    const out: ContainerRef[] = [];
    const visit = (coll: Collection, c: Container, labels: string[], depth: number) => {
      out.push({ collectionId: coll.id, containerId: c.id, label: labels.join(' / '), depth });
      for (const f of c.folders) {
        visit(coll, f, [...labels, f.name], depth + 1);
      }
    };
    for (const coll of this.collections) {
      visit(coll, coll, [coll.name], 0);
    }
    return out;
  }

  /** La colección o carpeta con ese id (la colección misma si `containerId` es su id). */
  getContainer(collId: string, containerId: string): Container | undefined {
    const coll = this.getCollection(collId);
    return coll ? findContainer(coll, containerId) : undefined;
  }

  // ---------- carpetas ----------
  getFolder(collId: string, folderId: string): Folder | undefined {
    const coll = this.getCollection(collId);
    return coll ? findFolderLoc(coll, folderId)?.folder : undefined;
  }
  /** Crea una carpeta en la colección o, si se indica `parentId`, dentro de otra carpeta. */
  addFolder(collId: string, name: string, parentId?: string): Folder | undefined {
    const coll = this.getCollection(collId);
    if (!coll) {
      return undefined;
    }
    const parent = parentId ? findContainer(coll, parentId) : coll;
    if (!parent) {
      return undefined;
    }
    const folder: Folder = { id: randomUUID(), name, requests: [], folders: [] };
    parent.folders.push(folder);
    this.saveCollections();
    return folder;
  }
  renameFolder(collId: string, folderId: string, name: string): boolean {
    const folder = this.getFolder(collId, folderId);
    if (!folder) {
      return false;
    }
    folder.name = name;
    this.saveCollections();
    return true;
  }
  /** Elimina la carpeta con todo lo que contiene. */
  deleteFolder(collId: string, folderId: string): boolean {
    const coll = this.getCollection(collId);
    const loc = coll ? findFolderLoc(coll, folderId) : undefined;
    if (!loc) {
      return false;
    }
    loc.parent.folders.splice(loc.index, 1);
    this.saveCollections();
    return true;
  }
  /** Copia profunda (ids nuevas) colocada justo después de la original. */
  duplicateFolder(collId: string, folderId: string): Folder | undefined {
    const coll = this.getCollection(collId);
    const loc = coll ? findFolderLoc(coll, folderId) : undefined;
    if (!loc) {
      return undefined;
    }
    const copy = cloneFolder(loc.folder);
    copy.name = loc.folder.name + ' (copia)';
    loc.parent.folders.splice(loc.index + 1, 0, copy);
    this.saveCollections();
    return copy;
  }
  /**
   * Mueve una carpeta a otra carpeta o colección (también de otra colección).
   * `index` es la posición final dentro de la lista de destino; sin índice, al final.
   * Devuelve false si no existe el origen o el destino, o si se intenta meter la carpeta
   * dentro de sí misma o de una de sus subcarpetas.
   */
  moveFolder(
    fromCollId: string,
    folderId: string,
    toCollId: string,
    toParentId?: string,
    index?: number
  ): boolean {
    const from = this.getCollection(fromCollId);
    const to = this.getCollection(toCollId);
    const loc = from ? findFolderLoc(from, folderId) : undefined;
    if (!from || !to || !loc) {
      return false;
    }
    const target = toParentId ? findContainer(to, toParentId) : to;
    if (!target) {
      return false;
    }
    for (const c of walk(loc.folder)) {
      if (c.id === target.id) {
        return false;
      }
    }
    loc.parent.folders.splice(loc.index, 1);
    insertAt(target.folders, loc.folder, index);
    this.saveCollections();
    return true;
  }

  // ---------- peticiones ----------
  getRequest(collId: string, reqId: string): ApiRequest | undefined {
    const coll = this.getCollection(collId);
    return coll ? findRequestLoc(coll, reqId)?.request : undefined;
  }
  /** Crea una petición en la colección o, si se indica `containerId`, dentro de una carpeta. */
  addRequest(
    collId: string,
    name: string,
    base?: ApiRequest,
    containerId?: string
  ): ApiRequest | undefined {
    const coll = this.getCollection(collId);
    if (!coll) {
      return undefined;
    }
    const target = containerId ? findContainer(coll, containerId) : coll;
    if (!target) {
      return undefined;
    }
    const r: ApiRequest = base
      ? { ...(JSON.parse(JSON.stringify(base)) as ApiRequest), id: randomUUID(), name }
      : newRequestTemplate(name);
    target.requests.push(r);
    this.saveCollections();
    return r;
  }
  updateRequest(collId: string, req: ApiRequest) {
    const coll = this.getCollection(collId);
    const loc = coll ? findRequestLoc(coll, req.id) : undefined;
    if (loc) {
      loc.container.requests[loc.index] = normalizeRequest(req);
      this.saveCollections();
    }
  }
  duplicateRequest(collId: string, reqId: string): ApiRequest | undefined {
    const coll = this.getCollection(collId);
    const loc = coll ? findRequestLoc(coll, reqId) : undefined;
    if (!loc) {
      return undefined;
    }
    const copy = cloneRequest(loc.request);
    copy.name = loc.request.name + ' (copia)';
    loc.container.requests.splice(loc.index + 1, 0, copy);
    this.saveCollections();
    return copy;
  }
  deleteRequest(collId: string, reqId: string) {
    const coll = this.getCollection(collId);
    const loc = coll ? findRequestLoc(coll, reqId) : undefined;
    if (loc) {
      loc.container.requests.splice(loc.index, 1);
      this.saveCollections();
    }
  }
  /**
   * Mueve una petición a otra carpeta o colección (también de otra colección).
   * Sin `toContainerId`, va a la raíz de la colección de destino.
   * `index` es la posición final dentro de la lista de destino; sin índice, al final.
   */
  moveRequest(
    fromCollId: string,
    reqId: string,
    toCollId: string,
    toContainerId?: string,
    index?: number
  ): boolean {
    const from = this.getCollection(fromCollId);
    const to = this.getCollection(toCollId);
    const loc = from ? findRequestLoc(from, reqId) : undefined;
    if (!from || !to || !loc) {
      return false;
    }
    const target = toContainerId ? findContainer(to, toContainerId) : to;
    if (!target) {
      return false;
    }
    loc.container.requests.splice(loc.index, 1);
    insertAt(target.requests, loc.request, index);
    this.saveCollections();
    return true;
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
  /** Usado por "Guardar en variable" y por rr.setVar. value === null borra. */
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
