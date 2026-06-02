import {
  getLibraryDetailStatus,
  resolveLibraryDetailMedia,
  type LibraryDetailViewState,
} from './ViewImage';
import type { LibraryGenerateResult } from '../services/api';

const imageTask: LibraryGenerateResult = {
  status: 'done',
  result: {
    outputImg: 'https://example.test/result.png',
    inputImg: ['https://example.test/input.png'],
    width: '768',
    height: '1024',
    errMsg: '',
    outputPreview: '',
    outputPoster: '',
  },
  botId: 'bot-1',
  slugId: 'slug-1',
  taskId: 'task-1',
  startTime: String(Date.now()),
  floorUrl: '',
  botName: 'Contract Bot',
  imageUrl: '',
  botType: 'image',
  likeStatus: '',
  estimateTaskDuration: '300000',
};

const videoTask: LibraryGenerateResult = {
  ...imageTask,
  taskId: 'task-video',
  botType: 'video',
  result: {
    ...imageTask.result,
    outputImg: 'https://example.test/result.mp4',
    outputPoster: 'https://example.test/poster.png',
  },
};

const runningTask: LibraryGenerateResult = {
  ...imageTask,
  status: 'running',
  result: {
    ...imageTask.result,
    outputImg: '',
  },
};

const imageMediaContract = resolveLibraryDetailMedia(imageTask);
const videoMediaContract = resolveLibraryDetailMedia(videoTask);
const runningStatusContract = getLibraryDetailStatus(runningTask);

const resolvedStateContract: LibraryDetailViewState = {
  task: imageTask,
  media: imageMediaContract,
  status: getLibraryDetailStatus(imageTask),
};

void videoMediaContract;
void runningStatusContract;
void resolvedStateContract;
