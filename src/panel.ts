import * as vscode from 'vscode';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { Store } from './store';
import { sendRequest } from './http';
import { ApiRequest } from './types';
import { normalizeRequest } from './model';

export function readOptions() {
  const cfg = vscode.workspace.getConfiguration('apiRequest');
  return {
    timeoutMs: Math.max(1000, cfg.get<number>('timeout', 30000)),
    followRedirects: cfg.get<boolean>('followRedirects', true),
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
          const result = await sendRequest(req, {
            vars: this.store.allVars(),
            options: readOptions(),
            setVar: (n, v, scope) => this.store.setVar(n, v, scope),
          });
          await this.store.addHistory(req, result.status, result.timeMs);
          this.panel.webview.postMessage({ type: 'response', result });
          break;
        }
      }
    }, null, context.subscriptions);
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
      .replace('%%JS%%', uri('main.js'));
  }
}
