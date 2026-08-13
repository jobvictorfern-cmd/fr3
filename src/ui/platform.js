/**
 * Camada de plataforma: isola as diferencas entre rodar no navegador e rodar
 * como aplicativo desktop (Tauri).
 *
 * No desktop existem caminho de arquivo, gravacao no lugar, lista de recentes,
 * menu nativo e associacao de arquivo. No navegador, abrir e um `<input file>`
 * e salvar e um download. O resto da aplicacao nao precisa saber em qual dos
 * dois esta.
 */

const bridge = typeof window !== 'undefined' ? window.__TAURI__ : null;

export const isDesktop = !!bridge;

const REPORT_FILTER = {
  name: 'Relatorios',
  extensions: ['fr3', 'term', 'xml', 'rav'],
};

const RAV_SIGNATURE = [0x52, 0x41, 0x56, 0x1a];

const looksBinary = (bytes) => RAV_SIGNATURE.every((byte, index) => bytes[index] === byte);

/** Texto de um .fr3: UTF-8 quando valido, senao ANSI (Windows-1252). */
function decodeText(bytes) {
  try {
    return { contents: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf8' };
  } catch {
    return { contents: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows1252' };
  }
}

const base64ToBytes = (base64) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const bytesToBase64 = (bytes) => {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

/** O plugin de dialogo ja devolveu string e objeto conforme a versao. */
function toPath(result) {
  if (!result) return null;
  if (typeof result === 'string') return result;
  return result.path || null;
}

function baseName(path) {
  return String(path).split(/[\\/]/).pop() || path;
}

/* ------------------------------- navegador -------------------------------- */

function browserPlatform() {
  const pickFile = () =>
    new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.fr3,.term,.xml,.rav';
      input.addEventListener('change', () => resolve(input.files?.[0] || null), { once: true });
      input.click();
    });

  return {
    isDesktop: false,

    async initialFile(options = {}) {
      // A tela inicial e o ponto de partida; o exemplo so entra quando pedido.
      return options.sample ? loadSample() : null;
    },

    async open() {
      const file = await pickFile();
      if (!file) return null;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (looksBinary(bytes)) {
        return { path: null, name: file.name, contents: bytes, encoding: 'binario' };
      }
      return { path: null, name: file.name, ...decodeText(bytes) };
    },

    async openPath() {
      return null;
    },

    async save({ contents, name, binary }) {
      const blob = binary
        ? new Blob([contents], { type: 'application/octet-stream' })
        : new Blob([contents], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const base = (name || 'relatorio').replace(/\.(fr3|term|xml|rav)$/i, '');
      link.download = base + (binary ? '.rav' : '.fr3');
      link.click();
      URL.revokeObjectURL(url);
      return { path: null, name: link.download };
    },

    async recent() {
      return [];
    },

    async confirm(message) {
      return window.confirm(message);
    },

    async alert(message) {
      window.alert(message);
    },

    onMenu() {},
    onOpenFile() {},
    onCloseRequested() {},
    setTitle(title) {
      document.title = title;
    },
  };
}

/* -------------------------------- desktop --------------------------------- */

function desktopPlatform() {
  const { core, event, dialog, window: tauriWindow } = bridge;
  const invoke = (command, args) => core.invoke(command, args);

  const readPath = async (path) => {
    const file = /\.rav$/i.test(path)
      ? await readBinary(path)
      : await invoke('read_report', { path });
    await invoke('push_recent', { path: file.path });
    await invoke('refresh_menu');
    return file;
  };

  /** Arquivos .rav trafegam em base64: o IPC do Tauri e JSON. */
  const readBinary = async (path) => {
    const file = await invoke('read_binary', { path });
    return {
      path: file.path,
      name: file.name,
      contents: base64ToBytes(file.base64),
      encoding: 'binario',
    };
  };

  return {
    isDesktop: true,

    async initialFile(options = {}) {
      if (options.sample) return loadSample();
      // Arquivo recebido por duplo clique / linha de comando.
      const path = await invoke('pending_file');
      return path ? readPath(path) : null;
    },

    async open() {
      const selected = toPath(
        await dialog.open({ multiple: false, directory: false, filters: [REPORT_FILTER] })
      );
      return selected ? readPath(selected) : null;
    },

    openPath: readPath,

    async save({ contents, path, name, encoding, binary }, { saveAs = false } = {}) {
      let target = saveAs ? null : path;
      if (!target) {
        target = toPath(
          await dialog.save({
            defaultPath: name || 'relatorio.fr3',
            filters: [REPORT_FILTER],
          })
        );
        if (!target) return null;
      }
      if (binary) {
        await invoke('write_binary', { path: target, base64: bytesToBase64(contents) });
      } else {
        await invoke('write_report', { path: target, contents, encoding: encoding || 'utf8' });
      }
      await invoke('push_recent', { path: target });
      await invoke('refresh_menu');
      return { path: target, name: baseName(target) };
    },

    async recent() {
      return invoke('recent_files');
    },

    async confirm(message) {
      return dialog.ask(message, { title: 'Editor FR3', kind: 'warning' });
    },

    async alert(message) {
      return dialog.message(message, { title: 'Editor FR3', kind: 'error' });
    },

    onMenu(handler) {
      event.listen('menu', (payload) => handler(payload.payload));
    },

    onOpenFile(handler) {
      event.listen('abrir-arquivo', (payload) => handler(payload.payload));
    },

    onFileDrop(handler) {
      event.listen('tauri://drag-drop', (payload) => {
        const path = payload.payload?.paths?.[0];
        if (path) handler(path);
      });
    },

    onCloseRequested(handler) {
      const current = tauriWindow.getCurrentWindow();
      current.onCloseRequested(async (closeEvent) => {
        const allowed = await handler();
        if (!allowed) closeEvent.preventDefault();
      });
    },

    setTitle(title) {
      document.title = title;
      try {
        tauriWindow.getCurrentWindow().setTitle(title);
      } catch {
        /* janela ainda nao disponivel: o titulo do documento ja foi ajustado */
      }
    },
  };
}

/** Relatorio de exemplo que acompanha o projeto. */
async function loadSample() {
  try {
    const response = await fetch('samples/rsiamac_1.fr3');
    if (!response.ok) return null;
    return { path: null, name: 'rsiamac_1.fr3', contents: await response.text(), encoding: 'utf8' };
  } catch {
    return null;
  }
}

export const platform = isDesktop ? desktopPlatform() : browserPlatform();
