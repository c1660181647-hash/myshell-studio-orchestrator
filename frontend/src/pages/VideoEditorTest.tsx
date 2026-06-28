// 独立的视频编辑器测试页面
import VideoEditor from './VideoEditor';

export default function VideoEditorTest() {
  return (
    <div className="h-screen w-screen">
      <VideoEditor
        projectId="test-project"
        onBack={() => window.history.back()}
      />
    </div>
  );
}
