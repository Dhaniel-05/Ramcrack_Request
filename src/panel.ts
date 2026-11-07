import * as vscode from 'vscode';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { Store } from './store';
import { sendRequest } from './http';
import { ApiRequest } from './types';
import { normalizeRequest } from './model';
import { findPlainSecrets } from './secrets';

export function readOptions() {
  const cfg = vscode.workspace.getConfiguration('apiRequest');
  return {
    timeoutMs: Math.max(1000, cfg.get<number>('timeout', 30000)),
    followRedirects: cfg.get<boolean>('followRedirects', true),
    useCookies: cfg.get<boolean>('useCookies', true),
  };
}

const titleOf = (r: { method: string; name: string }) => `${r.method} ${r.name || 'Petición'}`;

/** Un panel (webview) por petición abierta. */
export class RequestPanel {
  private static panels = new Map<string, RequestPanel>();

  static open(context: vscode.ExtensionContext, store: Store, collId: string, reqId: string) {
    const existing = RequestPanel.panels.get(reqId);
    if (existing) {
      existing.panel.reveal();
      return;
    }
    const req = store.getRequest(collId, reqId);
    if (!req) {
      return;
    }
    RequestPanel.panels.set(reqId, new RequestPanel(context, store, collId, req));
  }

  /** Se llama cuando el store cambia: actualiza títulos y variables de cada panel. */
  static refresh(store: Store) {
    for (const p of RequestPanel.panels.values()) {
      const r = store.getRequest(p.collId, p.reqId);
      if (r) {
        p.panel.title = titleOf(r);
        p.panel.webview.postMessage({ type: 'env', env: store.activeEnv, vars: store.allVars() });
      } else {
        p.panel.dispose();
      }
    }
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly reqId: string;
  /** Peticiones de las que ya se avisó en esta sesión (no se repite el aviso en cada envío). */
  private static warned = new Set<string>();

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: Store,
    private readonly collId: string,
    req: ApiRequest
  ) {
    this.reqId = req.id;
    const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');
    this.panel = vscode.window.createWebviewPanel(
      'apiRequest.request',
      titleOf(req),
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [mediaRoot] }
    );
    this.panel.webview.html = this.html();

    this.panel.onDidDispose(() => RequestPanel.panels.delete(this.reqId), null, context.subscriptions);

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'ready':
          this.panel.webview.postMessage({
            type: 'init',
            request: this.store.getRequest(this.collId, this.reqId),
            env: this.store.activeEnv,
            vars: this.store.allVars(),
          });
          break;
        case 'save':
          this.persist(msg.request);
          break;
        case 'pickFile': {
          const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Seleccionar' });
          if (picked?.[0]) {
            this.panel.webview.postMessage({
              type: 'file',
              target: msg.target,
              index: msg.index,
              path: picked[0].fsPath,
            });
          }
          break;
        }
        case 'send': {
          const req = normalizeRequest(msg.request);
          this.persist(req);
          this.warnPlainSecrets(req);
          const result = await sendRequest(req, {
            vars: this.store.allVars(),
            activeEnv: this.store.activeEnv,
            cookieJar: readOptions().useCookies ? this.store.getCookieJar() : undefined,
            options: readOptions(),
            setVar: (n, v, scope) => this.store.setVar(n, v, scope),
          });
          if (readOptions().useCookies) {
            this.store.saveCookies();
          }
          await this.store.addHistory(req, result.status, result.timeMs);
          this.panel.webview.postMessage({ type: 'response', result });
          break;
        }
      }
    }, null, context.subscriptions);
  }

  /** Aviso discreto (no bloquea el envío): hay un secreto escrito a mano que se guardará en texto plano. */
  private warnPlainSecrets(req: ApiRequest) {
    const cfg = vscode.workspace.getConfiguration('apiRequest');
    if (!cfg.get<boolean>('warnPlainSecrets', true) || !this.store.inWorkspace() || RequestPanel.warned.has(req.id)) {
      return;
    }
    const found = findPlainSecrets(req);
    if (!found.length) {
      return;
    }
    RequestPanel.warned.add(req.id);
    const NEVER = 'No volver a avisar';
    void Promise.resolve(
      vscode.window.showWarningMessage(
        `"${req.name || 'Petición'}" lleva un valor sensible escrito a mano (${found.slice(0, 3).join(', ')}). ` +
          'Se guarda en texto plano en .api-request/collections.json. Mejor usa una variable, por ejemplo {{token}}.',
        NEVER
      )
    ).then((pick) => {
      if (pick === NEVER) {
        void cfg.update('warnPlainSecrets', false, vscode.ConfigurationTarget.Global);
      }
    });
  }

  private persist(req: ApiRequest) {
    if (!req || req.id !== this.reqId) {
      return;
    }
    this.store.updateRequest(this.collId, req);
    this.panel.title = titleOf(req);
  }

  private html(): string {
    const webview = this.panel.webview;
    const uri = (f: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', f)).toString();
    const nonce = randomUUID().replace(/-/g, '');
    const csp = `default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';`;
    const template = fs.readFileSync(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'panel.html').fsPath,
      'utf8'
    );
    return template
      .replace('%%CSP%%', csp)
      .replace(/%%NONCE%%/g, nonce)
      .replace('%%CSS%%', uri('main.css'))
      .replace('%%EDIT%%', uri('editing.js'))
      .replace('%%JS%%', uri('main.js'));
  }
}
