import { fetchStudioDispatchSession, type StudioDispatchSession, type StudioHandoffArtifact } from './dreamyUnified';

async function dispatchSessionRestoreContract(): Promise<StudioDispatchSession> {
  return fetchStudioDispatchSession('dispatch_session_contract', {
    targetId: 'dispatch:explore',
  });
}

void dispatchSessionRestoreContract;

const dispatchTargetArtifactContract: StudioHandoffArtifact = {
  id: 'dispatch-target:dispatch_session_contract:dispatch:explore',
  label: 'Dispatch Target Explore',
  endpoint: '/api/studio/dispatch-sessions/{session_id}',
  url: '/api/studio/dispatch-sessions/dispatch_session_contract?target_id=dispatch%3Aexplore',
  uiUrl: '/dreamy?dispatch_session_id=dispatch_session_contract&target_id=dispatch%3Aexplore',
  sessionId: 'dispatch_session_contract',
  targetId: 'dispatch:explore',
};

void dispatchTargetArtifactContract;
