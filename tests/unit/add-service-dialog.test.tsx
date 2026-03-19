import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddServiceDialog } from '@/components/AddServiceDialog';
import { useAppStore } from '@/stores/app-store';
import { DEFAULT_SERVICES } from '@/types';

class MockImage {
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  private _src = '';

  static successfulUrls = new Set<string>();

  set src(value: string) {
    this._src = value;
    queueMicrotask(() => {
      if (MockImage.successfulUrls.has(value)) {
        this.onload?.();
        return;
      }

      this.onerror?.();
    });
  }

  get src() {
    return this._src;
  }
}

describe('AddServiceDialog', () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState({
      services: DEFAULT_SERVICES,
      activeServiceId: DEFAULT_SERVICES.find((service) => service.enabled)?.id ?? null,
      settingsPageOpen: false,
      settingsActiveTab: 'services',
      addServiceDialogOpen: true,
    });
    MockImage.successfulUrls.clear();
    vi.stubGlobal('Image', MockImage as unknown as typeof Image);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves the first probeable icon candidate for a custom service', async () => {
    MockImage.successfulUrls.add('https://example.com/apple-touch-icon.png');

    render(<AddServiceDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Example AI' } });
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'example.com' } });

    await waitFor(() => {
      expect(screen.getByText('Will use: https://example.com/apple-touch-icon.png')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add Service' }));

    const addedService = useAppStore
      .getState()
      .services.find((service) => service.name === 'Example AI' && service.id.startsWith('custom-'));

    expect(addedService?.iconUrl).toBe('https://example.com/apple-touch-icon.png');
  });

  it('does not persist a guessed favicon URL when auto-probe fails', async () => {
    render(<AddServiceDialog />);

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Broken AI' } });
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'broken.example.com' } });

    await waitFor(() => {
      expect(screen.queryByText(/Will use:/)).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add Service' }));

    const addedService = useAppStore
      .getState()
      .services.find((service) => service.name === 'Broken AI' && service.id.startsWith('custom-'));

    expect(addedService?.iconUrl).toBeUndefined();
  });
});
