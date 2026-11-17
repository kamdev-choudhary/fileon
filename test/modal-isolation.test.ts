import { afterEach, beforeEach, describe as group, expect, it, vi } from 'vitest';
import { FilePreviewModalElement } from '../src/elements/file-preview-modal.js';

/**
 * Stand-in for a Radix/shadcn Dialog or Sheet: the listeners it installs on
 * document while open, reduced to what they do to anything outside its content.
 */
function fakeHostModal() {
  const content = document.createElement('div');
  const trigger = document.createElement('button');
  content.append(trigger);
  document.body.append(content);

  const dismissed = vi.fn();
  const refocused = vi.fn();
  const wheelCancelled = vi.fn();
  const outside = (e: Event): boolean => !content.contains(e.target as Node);

  // DismissableLayer: pointerdown / focusin outside → close.
  const onPointerDown = (e: Event): void => {
    if (outside(e)) dismissed('pointerdown');
  };
  const onFocusIn = (e: Event): void => {
    if (outside(e)) {
      dismissed('focusin');
      refocused('focusin');
    }
  };
  // FocusScope: focus leaving to a known element outside → pull it back.
  const onFocusOut = (e: FocusEvent): void => {
    if (e.relatedTarget && !content.contains(e.relatedTarget as Node)) refocused('focusout');
  };
  // useEscapeKeydown: capture on document.
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') dismissed('escape');
  };
  // react-remove-scroll: cancel wheel outside the locked element.
  const onWheel = (e: Event): void => {
    if (outside(e)) wheelCancelled();
  };

  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut as EventListener);
  document.addEventListener('keydown', onKeyDown as EventListener, { capture: true });
  document.addEventListener('wheel', onWheel);
  document.body.style.pointerEvents = 'none';

  return {
    trigger,
    dismissed,
    refocused,
    wheelCancelled,
    teardown() {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut as EventListener);
      document.removeEventListener('keydown', onKeyDown as EventListener, { capture: true });
      document.removeEventListener('wheel', onWheel);
      document.body.style.pointerEvents = '';
      content.remove();
    },
  };
}

group('modal inside a host modal', () => {
  let host: ReturnType<typeof fakeHostModal>;
  let modal: FilePreviewModalElement;

  beforeEach(() => {
    host = fakeHostModal();
    modal = new FilePreviewModalElement();
    document.body.append(modal);
  });

  afterEach(() => {
    modal.close();
    modal.remove();
    host.teardown();
  });

  const open = (): void => {
    host.trigger.focus();
    modal.show(new Blob(['hello'], { type: 'text/plain' }));
  };
  const inner = (): HTMLElement => modal.shadowRoot!.querySelector<HTMLElement>('.fp-nav')!;

  it('hands focus over without tripping the host focus trap', () => {
    open();
    expect(document.activeElement).not.toBe(host.trigger);
    inner().focus();
    expect(host.refocused).not.toHaveBeenCalled();
    expect(host.dismissed).not.toHaveBeenCalled();
  });

  it('does not let pointer, click or wheel events reach document', () => {
    open();
    const target = inner();
    target.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    target.dispatchEvent(new Event('wheel', { bubbles: true, composed: true }));
    const onClick = vi.fn();
    document.addEventListener('click', onClick);
    target.dispatchEvent(new Event('click', { bubbles: true, composed: true }));
    document.removeEventListener('click', onClick);

    expect(host.dismissed).not.toHaveBeenCalled();
    expect(host.wheelCancelled).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('closes on Escape without also closing the host modal', () => {
    open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(modal.open).toBe(false);
    expect(host.dismissed).not.toHaveBeenCalled();
  });

  it('restores focus to the host modal on close', () => {
    open();
    modal.close();
    expect(document.activeElement).toBe(host.trigger);
  });

  it('clears aria-hidden / inert a host modal put on the reused element', () => {
    modal.setAttribute('aria-hidden', 'true');
    modal.setAttribute('inert', '');
    open();
    expect(modal.hasAttribute('aria-hidden')).toBe(false);
    expect(modal.hasAttribute('inert')).toBe(false);
  });

  it('stops isolating once closed', () => {
    open();
    modal.close();
    modal.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    expect(host.dismissed).toHaveBeenCalledWith('pointerdown');
  });
});
