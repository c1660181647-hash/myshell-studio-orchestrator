import { resolveInitialEntry, resolveSpaPathEntry } from './initialEntry';

const libraryDetailPathContract = resolveSpaPathEntry({
  pathname: '/library/studio-preview',
  search: '',
});

const energyHistoryPathContract = resolveInitialEntry({
  pathname: '/energy-history',
  search: '',
});

const botPathContract = resolveInitialEntry({
  pathname: '/bot',
  search: '?slug_id=luna-star',
});

const pageParamStillWinsContract = resolveInitialEntry({
  pathname: '/',
  search: '?page=library-detail&id=studio-preview',
});

const rootSlugFallbackContract = resolveInitialEntry({
  pathname: '/',
  search: '?slug_id=luna-star',
});

void libraryDetailPathContract;
void energyHistoryPathContract;
void botPathContract;
void pageParamStillWinsContract;
void rootSlugFallbackContract;
