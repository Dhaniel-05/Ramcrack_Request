export interface KV {
  key: string;
  value: string;
  enabled: boolean;
}

export interface FormField extends KV {
  type: 'text' | 'file';
}

export type BodyType = 'none' | 'json' | 'xml' | 'text' | 'form' | 'formurl' | 'graphql' | 'binary';
export type AuthType = 'none' | 'basic' | 'bearer' | 'apikey';

export interface Assertion {
  enabled: boolean;
  source: 'status' | 'time' | 'header' | 'json' | 'body';
  key: string;
  op: string;
  value: string;
}

export interface SetVar {
  enabled: boolean;
  /** json.token | header.x | cookie.x | text | null | delete | valor literal */
  source: string;
  /** {{variable}} | {{variable, global}} */
  target: string;
}

export interface ApiRequest {
  id: string;
  name: string;
  method: string;
  url: string;
  description: string;
  headers: KV[];
  body: {
    type: BodyType;
    content: string;
    formurl: KV[];
    form: FormField[];
    gqlQuery: string;
    gqlVars: string;
    file: string;
  };
  auth: {
    type: AuthType;
    token: string;
    username: string;
    password: string;
    keyName: string;
    keyValue: string;
    keyIn: 'header' | 'query';
  };
  tests: { assertions: Assertion[]; setVars: SetVar[] };
  preRun: string;
}

/** Carpeta dentro de una colección (o de otra carpeta). */
export interface Folder {
  id: string;
  name: string;
  requests: ApiRequest[];
  folders: Folder[];
}

export interface Collection {
  id: string;
  name: string;
  requests: ApiRequest[];
  /** Opcional en archivos de la 0.2.x; se normaliza a [] al cargar. */
  folders: Folder[];
}

/** Colección o carpeta: ambas contienen peticiones y carpetas. */
export type Container = Collection | Folder;

export interface EnvFile {
  activeEnv: string;
  environments: Record<string, Record<string, string>>;
  globals: Record<string, string>;
}

export interface TestResult {
  name: string;
  pass: boolean;
  detail: string;
}

export interface CookieInfo {
  name: string;
  value: string;
  attrs: string;
}

export interface ResponseResult {
  ok: boolean;
  status: number;
  statusText: string;
  timeMs: number;
  size: number;
  headers: [string, string][];
  cookies: CookieInfo[];
  body: string;
  tests: TestResult[];
  varMessages: string[];
  logs: string[];
  error?: string;
}

export interface HistoryEntry {
  id: string;
  at: number;
  status: number;
  timeMs: number;
  request: ApiRequest;
}
