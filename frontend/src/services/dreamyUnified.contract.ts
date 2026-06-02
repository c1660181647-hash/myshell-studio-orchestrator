import {
  cancelStudioDispatchSession,
  createStudioDispatchSession,
  fetchStudioDispatchSession,
  planStudioDispatchBatch,
  type StudioActionResolveResult,
  type StudioDispatchBatchPlan,
  type StudioDispatchSession,
  type StudioHandoffArtifact,
  type StudioHandoffAction,
} from './dreamyUnified';

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

const dispatchTargetActionContract: Pick<StudioActionResolveResult, 'next'> = {
  next: {
    url: '/api/studio/dispatch-sessions/dispatch_session_contract?target_id=dispatch%3Aexplore',
    uiUrl: '/dreamy?dispatch_session_id=dispatch_session_contract&target_id=dispatch%3Aexplore',
    sessionId: 'dispatch_session_contract',
    targetId: 'dispatch:explore',
  },
};

void dispatchTargetActionContract;

const dispatchTargetHandoffActionContract: StudioHandoffAction = {
  id: 'dispatch-target:inspect-gap:dispatch_session_contract:dispatch:explore',
  action: 'inspect-gap',
  kind: 'dispatch_target',
  targetId: 'dispatch:explore',
  targetName: 'Explore',
  status: 'error',
  reason: 'error',
  sessionId: 'dispatch_session_contract',
  uiUrl: '/dreamy?dispatch_session_id=dispatch_session_contract&target_id=dispatch%3Aexplore',
};

void dispatchTargetHandoffActionContract;

async function remainingDispatchBatchContract(): Promise<StudioDispatchBatchPlan> {
  return planStudioDispatchBatch({
    projectId: 'project_contract',
    sourceSegmentId: 'segment_contract',
    excludeCovered: true,
  });
}

void remainingDispatchBatchContract;

async function remainingDispatchSessionContract(): Promise<StudioDispatchSession> {
  return createStudioDispatchSession({
    projectId: 'project_contract',
    sourceSegmentId: 'segment_contract',
    excludeCovered: true,
  });
}

void remainingDispatchSessionContract;

async function cancelDispatchSessionContract(): Promise<StudioDispatchSession> {
  return cancelStudioDispatchSession('dispatch_session_contract');
}

void cancelDispatchSessionContract;
