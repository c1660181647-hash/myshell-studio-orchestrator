import { X } from 'lucide-react';

interface KeyboardHelpProps {
  onClose: () => void;
}

export default function KeyboardHelp({ onClose }: KeyboardHelpProps) {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const cmdKey = isMac ? '⌘' : 'Ctrl';

  const shortcuts = [
    {
      category: '播放控制',
      items: [
        { keys: ['Space'], desc: '播放/暂停' },
        { keys: ['J'], desc: '倒放（连按加速）' },
        { keys: ['K'], desc: '暂停' },
        { keys: ['L'], desc: '正放（连按加速）' },
        { keys: ['←'], desc: '后退1帧' },
        { keys: ['→'], desc: '前进1帧' },
        { keys: ['Shift', '←'], desc: '后退10帧' },
        { keys: ['Shift', '→'], desc: '前进10帧' },
        { keys: ['Home'], desc: '跳到开头' },
        { keys: ['End'], desc: '跳到结尾' },
      ],
    },
    {
      category: '标记点',
      items: [
        { keys: ['I'], desc: '设置入点' },
        { keys: ['O'], desc: '设置出点' },
        { keys: ['X'], desc: '清除入/出点' },
      ],
    },
    {
      category: '编辑工具',
      items: [
        { keys: ['C'], desc: '切换到切割工具' },
        { keys: ['V'], desc: '切换到选择工具' },
      ],
    },
    {
      category: '剪贴板',
      items: [
        { keys: [cmdKey, 'C'], desc: '复制片段属性' },
        { keys: [cmdKey, 'V'], desc: '粘贴片段属性' },
        { keys: [cmdKey, 'X'], desc: '剪切片段' },
      ],
    },
    {
      category: '片段操作',
      items: [
        { keys: ['Delete'], desc: '删除选中片段' },
        { keys: [cmdKey, 'B'], desc: '在播放头切割' },
        { keys: [cmdKey, 'A'], desc: '全选片段' },
        { keys: [cmdKey, 'D'], desc: '取消选择' },
      ],
    },
    {
      category: '撤销/重做',
      items: [
        { keys: [cmdKey, 'Z'], desc: '撤销' },
        { keys: [cmdKey, 'Shift', 'Z'], desc: '重做' },
      ],
    },
    {
      category: '视图',
      items: [
        { keys: [cmdKey, '+'], desc: '放大时间线' },
        { keys: [cmdKey, '-'], desc: '缩小时间线' },
        { keys: [cmdKey, '0'], desc: '重置缩放' },
        { keys: [cmdKey, '1'], desc: '预览画质：高清' },
        { keys: [cmdKey, '2'], desc: '预览画质：标准' },
        { keys: [cmdKey, '3'], desc: '预览画质：流畅' },
      ],
    },
    {
      category: '其他',
      items: [
        { keys: [cmdKey, 'S'], desc: '手动保存' },
        { keys: [cmdKey, 'E'], desc: '导出视频' },
        { keys: ['?'], desc: '显示快捷键帮助' },
      ],
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="relative w-[800px] max-h-[80vh] bg-[#1f1f1f] rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">键盘快捷键</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 transition-colors"
          >
            <X size={20} className="text-white/70" />
          </button>
        </div>

        {/* 快捷键列表 */}
        <div className="p-6 overflow-y-auto max-h-[calc(80vh-80px)] grid grid-cols-2 gap-6">
          {shortcuts.map((section) => (
            <div key={section.category}>
              <h3 className="text-sm font-semibold text-white/90 mb-3">{section.category}</h3>
              <div className="space-y-2">
                {section.items.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between text-sm">
                    <span className="text-white/60">{item.desc}</span>
                    <div className="flex items-center gap-1">
                      {item.keys.map((key, keyIdx) => (
                        <span key={keyIdx} className="flex items-center gap-1">
                          <kbd className="px-2 py-1 text-xs font-mono bg-white/5 border border-white/10 rounded">
                            {key}
                          </kbd>
                          {keyIdx < item.keys.length - 1 && (
                            <span className="text-white/40 text-xs">+</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 底部提示 */}
        <div className="px-6 py-3 border-t border-white/10 bg-white/5">
          <p className="text-xs text-white/50 text-center">
            按 <kbd className="px-1.5 py-0.5 text-xs font-mono bg-white/5 border border-white/10 rounded">?</kbd> 或{' '}
            <kbd className="px-1.5 py-0.5 text-xs font-mono bg-white/5 border border-white/10 rounded">Esc</kbd> 关闭此窗口
          </p>
        </div>
      </div>
    </div>
  );
}
