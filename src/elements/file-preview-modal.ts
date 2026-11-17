import { el, disposer } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { modalCss, makeStyles, applyStyles } from '../ui/styles.js';
import { toSources } from '../core/source.js';
import type { PreviewInput, Source } from '../core/source.js';
import { getConfig } from '../core/config.js';
import { FilePreviewElement } from './file-preview.js';

/** `fp-change` detail, fired when a gallery moves between files. */
export interface ChangeDetail {
  index: number;
  source: Source;
}

/** Options accepted by {@link FilePreviewModalElement.show}. */
export interface ShowOptions {
  index?: number;
  theme?: 'light' | 'dark' | string;
}

const sheet = makeStyles(modalCss);

/** Elements that can hold focus, for initial focus placement. */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Events that other modal libraries watch at `document`/`window` level to decide
 * the user has interacted "outside" them. Radix (and so shadcn's Dialog/Sheet)
 * dismisses on `pointerdown`/`focusin` outside its content, drags focus back on
 * `focusin`, and react-remove-scroll cancels `wheel`/`touchmove` outside the
 * locked element. Stopping them at our host keeps a preview opened from inside
 * such a modal usable — and the host modal open underneath it.
 */
const ISOLATED_EVENTS = [
  'pointerdown',
  'mousedown',
  'touchstart',
  'touchmove',
  'touchend',
  'click',
  'wheel',
  'focusin',
  'focusout',
] as const;

/**
 * `<file-preview-modal>` — full-screen overlay around a `<file-preview>`.
 *
 * Built on a native `<dialog>` opened with `showModal()`, so the browser does
 * the hard parts: it renders in the top layer (above any z-index, and above a
 * host page's own modal `<dialog>`), makes the rest of the page inert so focus
 * cannot leave, and closes on the mobile back gesture. On top of that: focus is
 * restored on close, Escape and backdrop clicks close, and arrow keys move
 * through a gallery of files.
 */
export class FilePreviewModalElement extends HTMLElement {
  readonly #dialog: HTMLDialogElement;
  readonly #preview: FilePreviewElement;
  readonly #shell: HTMLElement;
  readonly #backdrop: HTMLElement;
  readonly #prevBtn: HTMLButtonElement;
  readonly #nextBtn: HTMLButtonElement;
  readonly #counter: HTMLElement;
  #items: Source[] = [];
  #index = 0;
  readonly #d = disposer();
  #lastFocused: Element | null = null;
  #ownsSources = false;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    applyStyles(shadow, sheet);

    this.#backdrop = el('div', { class: 'fp-backdrop', part: 'backdrop' });
    this.#preview = new FilePreviewElement();
    const theme = this.getAttribute('theme');
    if (theme) this.#preview.setAttribute('theme', theme);
    this.#preview.setAttribute('closable', '');
    this.#preview.setAttribute('chrome', 'modal');

    this.#prevBtn = el('button', {
      class: 'fp-nav fp-nav--prev',
      type: 'button',
      'aria-label': 'Previous file',
      html: icon('prev'),
      onClick: () => this.go(this.#index - 1),
    });
    this.#nextBtn = el('button', {
      class: 'fp-nav fp-nav--next',
      type: 'button',
      'aria-label': 'Next file',
      html: icon('next'),
      onClick: () => this.go(this.#index + 1),
    });
    this.#counter = el('div', { class: 'fp-counter' });

    this.#shell = el('div', { class: 'fp-shell', part: 'shell' }, [this.#preview]);
    this.#dialog = el('dialog', { class: 'fp-dialog', part: 'dialog' }, [
      this.#backdrop,
      this.#shell,
      this.#prevBtn,
      this.#nextBtn,
      this.#counter,
    ]);
    shadow.append(this.#dialog);

    // The browser can close the dialog without us: the Android back gesture and
    // other platform close requests. Keep our state in step when it does.
    this.#dialog.addEventListener('close', () => this.close());

    // Bubble phase on the host: everything inside the shadow root has already
    // handled the event by the time it gets here, so only listeners further up
    // (document, window) miss it.
    const isolate = (e: Event): void => {
      if (this.open) e.stopPropagation();
    };
    for (const type of ISOLATED_EVENTS) {
      this.addEventListener(type, isolate, { passive: true });
    }
  }

  connectedCallback(): void {
    this.#backdrop.addEventListener('click', () => this.close());
    this.#preview.addEventListener('fp-close', () => this.close());
    // Re-emit viewer events from the modal so callers can listen in one place.
    for (const type of ['fp-load', 'fp-error']) {
      this.#preview.addEventListener(type, (e: Event) => {
        this.dispatchEvent(new CustomEvent(type, { detail: (e as CustomEvent<unknown>).detail }));
      });
    }
  }

  disconnectedCallback(): void {
    this.#release();
  }

  get open(): boolean {
    return this.hasAttribute('open');
  }

  /** The inner `<file-preview>`, if you need direct access. */
  get preview(): FilePreviewElement {
    return this.#preview;
  }

  get index(): number {
    return this.#index;
  }

  /**
   * Open the modal.
   * @param input One file or a gallery of them.
   */
  show(input: PreviewInput | PreviewInput[], opts: ShowOptions = {}): this {
    // showModal() needs a connected element; don't make callers remember that.
    if (!this.isConnected) document.body.append(this);
    const config = getConfig();
    this.#disposeOwnSources();
    this.#items = toSources(input, {
      maxBytes: config.maxBytes,
      headers: config.headers,
      credentials: config.credentials,
    });
    this.#ownsSources = true;
    this.#index = Math.min(Math.max(0, opts.index ?? 0), Math.max(0, this.#items.length - 1));

    const theme = opts.theme ?? this.getAttribute('theme');
    if (theme) this.#preview.setAttribute('theme', theme);

    if (!this.open) {
      this.#lastFocused = document.activeElement;
      // A host modal (Radix Dialog's hideOthers, Headless UI, …) may have hidden
      // every body child that existed when it opened — including this reused
      // singleton. Nothing above us should be able to hide or disable us.
      this.removeAttribute('aria-hidden');
      this.removeAttribute('inert');
      // Release focus *before* taking it. Moving focus straight from a focus
      // trap's content into us fires a focusout whose relatedTarget is us, and
      // the trap (Radix FocusScope) answers by pulling focus back. A blur first
      // gives a focusout with no relatedTarget, which traps deliberately ignore,
      // and still lets the page's own blur handlers run.
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && !this.contains(active)) {
        active.blur();
      }
      this.setAttribute('open', '');
      this.#dialog.showModal();
      this.#bindGlobalKeys();
    }

    this.#render();
    // Focus lands inside the dialog so keyboard and screen-reader users are not
    // left behind on the page underneath.
    requestAnimationFrame(() => this.#focusFirst());
    return this;
  }

  /** Jump to a gallery index. */
  go(next: number): void {
    if (!this.#items.length) return;
    const clamped = Math.min(Math.max(0, next), this.#items.length - 1);
    if (clamped === this.#index) return;
    this.#index = clamped;
    this.#render();
    const source = this.#items[this.#index];
    if (!source) return;
    this.dispatchEvent(
      new CustomEvent<ChangeDetail>('fp-change', {
        detail: { index: this.#index, source },
      }),
    );
  }

  close(): void {
    if (!this.open) return;
    this.removeAttribute('open');
    if (this.#dialog.open) this.#dialog.close();
    this.#preview.clear();
    this.#release();
    this.dispatchEvent(new CustomEvent('fp-close'));
    // Put focus back where the user left it.
    const target = this.#lastFocused;
    this.#lastFocused = null;
    if (target?.isConnected && target instanceof HTMLElement) {
      target.focus({ preventScroll: true });
    }
  }

  // -------------------------------------------------------------- internals

  #render(): void {
    const source = this.#items[this.#index];
    if (!source) return;
    this.#preview.file = source;

    const many = this.#items.length > 1;
    this.#prevBtn.style.display = many ? '' : 'none';
    this.#nextBtn.style.display = many ? '' : 'none';
    this.#counter.style.display = many ? '' : 'none';
    this.#prevBtn.disabled = this.#index === 0;
    this.#nextBtn.disabled = this.#index === this.#items.length - 1;
    this.#counter.textContent = many ? `${this.#index + 1} of ${this.#items.length}` : '';
    // The host's aria-label wins; otherwise announce which file is open. A label
    // can't point into <file-preview>'s shadow root, so this is text, not an id.
    const label = this.getAttribute('aria-label');
    this.#dialog.setAttribute(
      'aria-label',
      label ?? (source.name ? `Preview of ${source.name}` : 'File preview'),
    );
  }

  #bindGlobalKeys(): void {
    // Window capture runs before anything registered on document — including a
    // host modal's own capture-phase Escape handler — so Escape closes only us,
    // not the dialog we were opened from.
    this.#d.listen(
      window,
      'keydown',
      ((e: KeyboardEvent) => {
        if (!this.open) return;
        if (e.key === 'Escape') {
          // Handled here rather than left to the dialog's own close request so
          // a host modal's Escape handler never sees it.
          e.preventDefault();
          e.stopPropagation();
          this.close();
          return;
        }
        // Don't hijack arrows while the user is typing in a field (the page
        // number box, or the font viewer's editable specimen).
        const active = this.shadowRoot?.activeElement ?? null;
        const deep = active?.shadowRoot?.activeElement ?? active;
        if (deep && /^(INPUT|TEXTAREA|SELECT)$/.test(deep.tagName)) return;
        if (deep instanceof HTMLElement && deep.isContentEditable) return;

        if (e.key === 'ArrowLeft') this.go(this.#index - 1);
        else if (e.key === 'ArrowRight') this.go(this.#index + 1);
      }) as EventListener,
      true,
    );
  }

  #focusables(): HTMLElement[] {
    const inner = this.#preview.shadowRoot?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [];
    const outer = this.shadowRoot?.querySelectorAll<HTMLElement>('.fp-nav') ?? [];
    return [...outer, ...inner].filter(
      (n) => n.offsetParent !== null || n.getClientRects().length > 0,
    );
  }

  #focusFirst(): void {
    const list = this.#focusables();
    (list[0] ?? this.#dialog).focus({ preventScroll: true });
  }

  #disposeOwnSources(): void {
    if (!this.#ownsSources) return;
    for (const s of this.#items) s.destroy();
    this.#items = [];
    this.#ownsSources = false;
  }

  #release(): void {
    this.#d.run();
    this.#disposeOwnSources();
  }
}

if (!customElements.get('file-preview-modal')) {
  customElements.define('file-preview-modal', FilePreviewModalElement);
}
