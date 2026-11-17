import { afterEach, describe as group, expect, it, vi } from 'vitest';
import { FilePreviewModalElement } from '../src/elements/file-preview-modal.js';

const file = (name = 'notes.txt'): File => new File(['hello'], name, { type: 'text/plain' });
const dialogOf = (m: FilePreviewModalElement): HTMLDialogElement =>
  m.shadowRoot!.querySelector('dialog')!;

group('<file-preview-modal>', () => {
  let modal: FilePreviewModalElement;

  afterEach(() => {
    modal.close();
    modal.remove();
  });

  it('opens a native modal dialog and closes it again', () => {
    modal = new FilePreviewModalElement();
    document.body.append(modal);
    const dialog = dialogOf(modal);
    const showModal = vi.spyOn(dialog, 'showModal');

    modal.show(file());
    expect(showModal).toHaveBeenCalledOnce();
    expect(dialog.open).toBe(true);
    expect(modal.open).toBe(true);

    modal.close();
    expect(dialog.open).toBe(false);
    expect(modal.open).toBe(false);
  });

  it('does not put dialog semantics on the host as well as the native dialog', () => {
    modal = new FilePreviewModalElement();
    document.body.append(modal);
    modal.show(file());
    expect(modal.hasAttribute('role')).toBe(false);
    expect(modal.hasAttribute('aria-modal')).toBe(false);
  });

  it('follows a close the browser made on its own (back gesture, close request)', () => {
    modal = new FilePreviewModalElement();
    document.body.append(modal);
    const onClose = vi.fn();
    modal.addEventListener('fp-close', onClose);
    modal.show(file());

    dialogOf(modal).close();
    expect(modal.open).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('names the dialog after the file, unless the host is labelled', () => {
    modal = new FilePreviewModalElement();
    document.body.append(modal);
    modal.show(file('q3-report.txt'));
    expect(dialogOf(modal).getAttribute('aria-label')).toBe('Preview of q3-report.txt');

    modal.setAttribute('aria-label', 'Attachment');
    modal.show(file('other.txt'));
    expect(dialogOf(modal).getAttribute('aria-label')).toBe('Attachment');
  });

  it('connects itself when shown before being added to the page', () => {
    modal = new FilePreviewModalElement();
    modal.show(file());
    expect(modal.isConnected).toBe(true);
    expect(dialogOf(modal).open).toBe(true);
  });

  it('leaves the page scroll alone', () => {
    modal = new FilePreviewModalElement();
    document.body.append(modal);
    modal.show(file());
    expect(document.body.style.overflow).toBe('');
    expect(document.body.style.paddingRight).toBe('');
  });
});

group('openPreview()', async () => {
  const { openPreview } = await import('../src/index.js');

  it('reuses one modal and resolves `closed` when it closes', async () => {
    const onClose = vi.fn();
    const first = openPreview(file('a.txt'), { onClose });
    const second = openPreview(file('b.txt'));
    expect(second.element).toBe(first.element);

    second.close();
    await expect(first.closed).resolves.toBeUndefined();
    await expect(second.closed).resolves.toBeUndefined();
    expect(onClose).toHaveBeenCalledOnce();
    first.element.remove();
  });
});
