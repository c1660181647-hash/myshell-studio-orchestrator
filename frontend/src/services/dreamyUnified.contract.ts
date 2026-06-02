import { fetchStudioDispatchSession, type StudioDispatchSession } from './dreamyUnified';

async function dispatchSessionRestoreContract(): Promise<StudioDispatchSession> {
  return fetchStudioDispatchSession('dispatch_session_contract', {
    targetId: 'dispatch:explore',
  });
}

void dispatchSessionRestoreContract;
