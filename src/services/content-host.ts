import { invoke } from '@tauri-apps/api/core';
import type { ChatService } from '@/types';

export type HostService = Pick<ChatService, 'id' | 'name' | 'url' | 'enabled'>;

type HostPlatform = 'windows' | 'macos' | 'linux' | 'unknown';

let hostPlatformPromise: Promise<HostPlatform> | null = null;

async function resolveHostPlatform(): Promise<HostPlatform> {
  if (!hostPlatformPromise) {
    hostPlatformPromise = invoke<HostPlatform>('host_platform').catch(() => 'unknown');
  }

  return hostPlatformPromise;
}

function toManagedServices(services: HostService[]) {
  return services.map(({ id, name, url, enabled }) => ({
    id,
    name,
    url,
    enabled,
  }));
}

function toServicePayload(service: HostService) {
  return {
    id: service.id,
    name: service.name,
    url: service.url,
    enabled: service.enabled,
  };
}

export async function usesDockedWindowContentHost() {
  return (await resolveHostPlatform()) === 'windows';
}

export async function activateServiceContent(service: HostService, services: HostService[]) {
  await invoke('activate_service_content', {
    service: toServicePayload(service),
    services: toManagedServices(services),
  });
}

export async function hideAllServiceContent() {
  await invoke('hide_all_service_content');
}

export async function syncServiceHostState(
  services: HostService[],
  activeServiceId: string | null
) {
  await invoke('sync_service_host_state', {
    services: toManagedServices(services),
    activeServiceId,
  });
}

export async function refreshServiceContent(service: HostService, services: HostService[]) {
  await invoke('refresh_service_content', {
    service: toServicePayload(service),
    services: toManagedServices(services),
  });
}

export async function syncDockedContentLayout() {
  if (!(await usesDockedWindowContentHost())) {
    return;
  }

  await invoke('sync_docked_content_layout');
}
