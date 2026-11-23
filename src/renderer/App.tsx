import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {
  JsonSchemaProperty,
  ProjectInfo,
  RuntimeInfo,
  SettingsDocument,
  SetupDraft,
  StudioBounds,
  TaskEvent,
  TaskKind,
  TaskState,
  VerificationResult,
} from '../shared/types';
import {sampleParameterTrack, upsertParameterKeyframe} from './parameter-utils';

type Tab = 'overview' | 'parameters' | 'studio' | 'tasks' | 'persistence';

const taskLabels: Record<TaskKind, string> = {
  install: '安装依赖', studio: 'Studio', check: '工程检查', render: '渲染视频', still: '导出静帧', verify: '恢复验证',
};

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const nestedValue = (value: Record<string, unknown>, dotPath?: string): unknown => {
  if (!dotPath) return undefined;
  return dotPath.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
};

const setNestedValue = (value: Record<string, unknown>, dotPath: string, next: unknown): Record<string, unknown> => {
  const clone = structuredClone(value);
  const parts = dotPath.split('.');
  let current = clone;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) current[part] = next;
    else {
      if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) current[part] = {};
      current = current[part] as Record<string, unknown>;
    }
  });
  return clone;
};

const getBounds = (element: HTMLElement): StudioBounds => {
  const rect = element.getBoundingClientRect();
  return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
};

export const App = () => {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [runtime, setRuntime] = useState<RuntimeInfo>();
  const [tab, setTab] = useState<Tab>('overview');
  const [tasks, setTasks] = useState<TaskState[]>([]);
  const [logs, setLogs] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const selected = projects.find((project) => project.id === selectedId) ?? projects[0];

  const reload = useCallback(async (preferredId?: string) => {
    const [nextProjects, nextRuntime, nextTasks] = await Promise.all([
      window.remotionManager.projects.list(),
      window.remotionManager.runtime.get(),
      window.remotionManager.tasks.states(),
    ]);
    setProjects(nextProjects);
    setRuntime(nextRuntime);
    setTasks(nextTasks);
    setSelectedId((current) => preferredId ?? current ?? nextProjects[0]?.id);
  }, []);

  useEffect(() => {
    void reload().catch((reason) => setError(errorMessage(reason)));
    return window.remotionManager.tasks.onEvent((event: TaskEvent) => {
      if (event.type === 'state' && event.state) {
        setTasks((current) => [...current.filter((item) => !(item.projectId === event.projectId && item.kind === event.kind)), event.state!]);
      } else if (event.text) {
        const key = `${event.projectId}:${event.kind}`;
        setLogs((current) => ({...current, [key]: `${current[key] ?? ''}${event.text}`.slice(-80_000)}));
      }
    });
  }, [reload]);

  useEffect(() => {
    if (tab !== 'studio') void window.remotionManager.studio.hide();
  }, [tab, selectedId]);

  const perform = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
      if (success) setNotice(success);
      await reload(selectedId);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const importProject = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const imported = await window.remotionManager.projects.pickAndImport();
      if (imported) {
        await reload(imported.id);
        setSelectedId(imported.id);
        setNotice('工程已加入列表');
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (!file) return;
    const droppedPath = window.remotionManager.files.pathForFile(file);
    await perform(async () => {
      const imported = await window.remotionManager.projects.importPath(droppedPath);
      setSelectedId(imported.id);
    }, '已导入拖入的工程');
  };

  return (
    <main className="app-shell" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">R</div>
          <div><strong>Remotion 工程管家</strong><span>持久化工作台</span></div>
        </div>
        <div className="sidebar-actions">
          <button className="primary" onClick={importProject}>＋ 添加工程</button>
          <button onClick={() => perform(() => window.remotionManager.projects.pickAndScan(), '扫描完成')}>扫描目录</button>
        </div>
        <div className="project-list">
          {projects.map((project) => (
            <button key={project.id} className={`project-item ${project.id === selected?.id ? 'active' : ''}`} onClick={() => {setSelectedId(project.id); setTab('overview');}}>
              <span className={`status-dot ${project.supported ? 'ok' : 'warn'}`} />
              <span><strong>{project.displayName}</strong><small>{project.packageManager} · {project.hasManifest ? '可编辑参数' : '待接入参数'}</small></span>
            </button>
          ))}
          {!projects.length && <div className="empty-sidebar">添加工程文件夹，或直接拖到窗口中。</div>}
        </div>
        <div className="runtime-card">
          <span className={`status-dot ${runtime?.ok ? 'ok' : 'bad'}`} />
          <div><strong>{runtime?.ok ? 'Node 环境正常' : 'Node 环境缺失'}</strong><small>{runtime?.nodeDirectory ?? '正在检测…'}</small></div>
          <button className="icon-button" title="选择 Node 目录" onClick={() => perform(async () => {await window.remotionManager.runtime.pickNodeDirectory();}, 'Node 目录已更新')}>⚙</button>
        </div>
      </aside>

      <section className="workspace">
        {selected ? <>
          <header className="topbar">
            <div className="project-title"><span className="eyebrow">当前工程</span><h1>{selected.displayName}</h1><p title={selected.path}>{selected.path}</p></div>
            <div className="top-actions">
              <button onClick={() => void window.remotionManager.projects.openFolder(selected.id)}>打开文件夹</button>
              <button className="primary" onClick={() => setTab('studio')}>打开 Studio</button>
            </div>
          </header>
          <nav className="tabs">
            {([['overview','概览'],['parameters','参数与关键帧'],['studio','Studio'],['tasks','任务与日志'],['persistence','持久化验证']] as const).map(([id,label]) =>
              <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
          </nav>
          <div className="content">
            {tab === 'overview' && <Overview project={selected} tasks={tasks} onTab={setTab} run={(kind) => perform(() => window.remotionManager.tasks.run(selected.id, kind), `${taskLabels[kind]}已启动`)} remove={() => perform(() => window.remotionManager.projects.remove(selected.id), '工程已从列表移除')} />}
            {tab === 'parameters' && <ParameterEditor project={selected} onProjectChanged={() => reload(selected.id)} />}
            {tab === 'studio' && <StudioPanel project={selected} />}
            {tab === 'tasks' && <TasksPanel project={selected} tasks={tasks} logs={logs} run={(kind) => perform(() => window.remotionManager.tasks.run(selected.id, kind), `${taskLabels[kind]}已启动`)} stop={(kind) => perform(() => window.remotionManager.tasks.stop(selected.id, kind), `${taskLabels[kind]}已停止`)} />}
            {tab === 'persistence' && <PersistencePanel project={selected} />}
          </div>
        </> : <Welcome onImport={importProject} onScan={() => perform(() => window.remotionManager.projects.pickAndScan(), '扫描完成')} />}
      </section>

      {(notice || error) && <div className={`toast ${error ? 'error' : ''}`} onClick={() => {setNotice(undefined); setError(undefined);}}>{error ?? notice}</div>}
      {busy && <div className="busy"><span /></div>}
    </main>
  );
};

const Welcome = ({onImport, onScan}: {onImport: () => void; onScan: () => void}) => (
  <div className="welcome">
    <div className="hero-orbit"><span /><span /><b>R</b></div>
    <span className="eyebrow">REMOTION PROJECT MANAGER</span>
    <h1>把每个动画工程，<br />放回可继续工作的地方。</h1>
    <p>统一启动 Studio、编辑 JSON 与关键帧、运行渲染，并验证关闭后的完整恢复。</p>
    <div><button className="primary" onClick={onImport}>选择工程文件夹</button><button onClick={onScan}>扫描工程目录</button></div>
    <small>也可以把包含 package.json 的文件夹拖到此窗口。</small>
  </div>
);

const Overview = ({project, tasks, onTab, run, remove}: {project: ProjectInfo; tasks: TaskState[]; onTab: (tab: Tab) => void; run: (kind: TaskKind) => void; remove: () => void}) => {
  const studio = tasks.find((task) => task.projectId === project.id && task.kind === 'studio');
  const cards = [
    ['依赖', project.hasRemotionCli ? '已就绪' : '首次运行时安装', project.hasRemotionCli],
    ['Studio', studio?.status === 'running' ? '运行中' : '未运行', studio?.status === 'running'],
    ['参数清单', project.hasManifest ? '已随工程保存' : '尚未接入', project.hasManifest],
    ['持久化', project.settings ? '可执行恢复验证' : '基础工程模式', Boolean(project.settings)],
  ];
  return <div className="stack">
    <section className="metric-grid">{cards.map(([label,value,ok]) => <article className="metric" key={String(label)}><span className={`status-dot ${ok ? 'ok' : 'warn'}`} /><small>{label}</small><strong>{value}</strong></article>)}</section>
    <section className="panel hero-panel"><div><span className="eyebrow">快速开始</span><h2>从工程本身恢复编辑环境</h2><p>所有运行命令都来自本工程的 package.json；参数和关键帧写回项目文件，不保存在临时预览中。</p></div><div className="button-stack"><button className="primary" onClick={() => onTab('studio')}>启动并嵌入 Studio</button><button onClick={() => onTab('parameters')}>{project.hasManifest ? '编辑参数与关键帧' : '接入参数 JSON'}</button></div></section>
    <section className="panel"><div className="panel-heading"><div><span className="eyebrow">工程能力</span><h2>已识别命令</h2></div></div><div className="action-grid">
      <button onClick={() => run('studio')}>Studio<small>{project.scripts.studio ?? project.entry ?? '不可用'}</small></button>
      <button disabled={!project.scripts.render} onClick={() => run('render')}>渲染视频<small>{project.scripts.render ?? '未定义 render 脚本'}</small></button>
      <button disabled={!project.scripts.still} onClick={() => run('still')}>导出静帧<small>{project.scripts.still ?? '未定义 still 脚本'}</small></button>
      <button onClick={() => run('check')}>工程检查<small>{project.scripts.check ?? '使用 Remotion compositions'}</small></button>
    </div></section>
    {project.warnings.length > 0 && <section className="panel warnings"><h3>需要注意</h3>{project.warnings.map((warning) => <p key={warning}>• {warning}</p>)}</section>}
    <button className="danger-link" onClick={() => {if (confirm('只会从软件列表移除，不会删除源工程。继续吗？')) remove();}}>从软件列表移除</button>
  </div>;
};

const ParameterEditor = ({project, onProjectChanged}: {project: ProjectInfo; onProjectChanged: () => Promise<void> | void}) => {
  const [document, setDocument] = useState<SettingsDocument>();
  const [value, setValue] = useState<Record<string, unknown>>({});
  const [history, setHistory] = useState<Record<string, unknown>[]>([]);
  const [frame, setFrame] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const [saveNotice, setSaveNotice] = useState<string>();
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!project.hasManifest || !project.settings) return;
    try {
      const next = await window.remotionManager.settings.load(project.id);
      setDocument(next); setValue(structuredClone(next.value)); setHistory([]); setDirty(false); setError(undefined); setSaveNotice(undefined);
    } catch (reason) { setError(errorMessage(reason)); }
  }, [project.id, project.hasManifest, project.settings]);
  useEffect(() => {void load();}, [load]);

  if (!project.hasManifest || !project.settings) return <SetupWizard project={project} onDone={onProjectChanged} />;
  if (!document) return <div className="panel">{error ?? '正在加载参数…'}</div>;

  const properties = document.schema.properties ?? {};
  const groups = Object.entries(properties).reduce<Record<string, Array<[string, JsonSchemaProperty]>>>((result, item) => {
    const group = item[1]['x-remotion-ui']?.group ?? '参数';
    (result[group] ??= []).push(item);
    return result;
  }, {});
  const keyframePath = document.config.keyframes?.containerPath;
  const keyframeContainer = nestedValue(value, keyframePath) as Record<string, Array<{frame: number; value: number}>> | undefined;

  const update = (key: string, next: unknown) => {
    setSaveNotice(undefined);
    setHistory((current) => [...current.slice(-49), structuredClone(value)]);
    setValue((current) => {
      const nextValue = {...current, [key]: next};
      const keyframable = properties[key]?.['x-remotion-ui']?.keyframable;
      if (!keyframable || !keyframePath || !Number.isFinite(Number(next))) return nextValue;
      const currentTracks = nestedValue(current, keyframePath);
      const tracks = currentTracks && typeof currentTracks === 'object' && !Array.isArray(currentTracks)
        ? structuredClone(currentTracks as Record<string, Array<{frame: number; value: number}>>)
        : {};
      tracks[key] = upsertParameterKeyframe(tracks[key] ?? [], frame, Number(next));
      return setNestedValue(nextValue, keyframePath, tracks);
    });
    setDirty(true);
  };
  const toggleKeyframe = (key: string) => {
    if (!keyframePath) return;
    setSaveNotice(undefined);
    const tracks = structuredClone(keyframeContainer ?? {});
    const points = Array.isArray(tracks[key]) ? tracks[key] : [];
    const existing = points.findIndex((point) => point.frame === frame);
    if (existing >= 0) points.splice(existing, 1);
    else points.push({frame, value: Number(value[key])});
    tracks[key] = points.sort((a, b) => a.frame - b.frame);
    setHistory((current) => [...current.slice(-49), structuredClone(value)]);
    setValue((current) => setNestedValue(current, keyframePath, tracks));
    setDirty(true);
  };
  const save = async () => {
    setSaving(true); setError(undefined);
    try {
      const next = await window.remotionManager.settings.save(project.id, value);
      setDocument(next); setValue(structuredClone(next.value)); setDirty(false); setHistory([]);
      setSaveNotice('参数已保存；运行中的 Studio 将自动同步，未打开的 Studio 会在下次启动时载入。');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setSaving(false); }
  };

  return <div className="parameter-layout">
    <div className="parameter-toolbar panel">
      <div><span className="eyebrow">编辑帧</span><strong>{frame} / {document.config.timeline.durationInFrames - 1}</strong></div>
      <input type="range" min={0} max={document.config.timeline.durationInFrames - 1} value={frame} onChange={(event) => setFrame(Number(event.target.value))} />
      <select value={String(nestedValue(value, document.config.keyframes?.easingPath) ?? 'smooth')} onChange={(event) => document.config.keyframes?.easingPath && setValue((current) => {setDirty(true); return setNestedValue(current, document.config.keyframes!.easingPath!, event.target.value);})}>
        <option value="smooth">平滑</option><option value="linear">线性</option><option value="hold">保持</option>
      </select>
      <button disabled={!history.length} onClick={() => {const previous = history.at(-1); if (previous) {setValue(previous); setHistory((current) => current.slice(0,-1)); setDirty(true);}}}>撤销</button>
      <button onClick={async () => {const imported = await window.remotionManager.settings.importJson(project.id); if (imported) {setHistory((current) => [...current, structuredClone(value)]); setValue(imported); setDirty(true);}}}>导入 JSON</button>
      <button onClick={() => void window.remotionManager.settings.exportJson(project.id, value)}>导出 JSON</button>
      <button className="primary" disabled={!dirty || saving} onClick={save}>{saving ? '正在写入…' : '应用到工程'}</button>
    </div>
    {error && <div className="inline-error">{error}</div>}
    {saveNotice && <div className="inline-success">{saveNotice}</div>}
    <div className="parameter-groups">{Object.entries(groups).map(([group, fields]) => <section className="panel parameter-group" key={group}><div className="panel-heading"><h2>{group}</h2><small>{fields.length} 项</small></div>{fields.sort((a,b) => (a[1]['x-remotion-ui']?.order ?? 0) - (b[1]['x-remotion-ui']?.order ?? 0)).map(([key, spec]) => {
      const hints = spec['x-remotion-ui'];
      const keyframable = hints?.keyframable && (spec.type === 'number' || spec.type === 'integer');
      const points = keyframeContainer?.[key] ?? [];
      const easing = String(nestedValue(value, document.config.keyframes?.easingPath) ?? 'smooth');
      const fieldValue = keyframable
        ? sampleParameterTrack(points, frame, easing, Number(value[key] ?? 0))
        : value[key];
      const hasKey = points.some((point) => point.frame === frame);
      return <div className="parameter-row" key={key}>
        <div className="parameter-label"><label>{spec.title ?? key}</label><small>{spec.description ?? key}</small></div>
        <div className="parameter-control">
          {spec.type === 'boolean' ? <label className="switch"><input type="checkbox" checked={Boolean(fieldValue)} onChange={(event) => update(key, event.target.checked)} /><span /></label> : spec.enum ? <select value={String(fieldValue)} onChange={(event) => update(key, event.target.value)}>{spec.enum.map((option) => <option key={String(option)}>{option}</option>)}</select> : spec.type === 'string' ? <input type={hints?.control === 'color' ? 'color' : 'text'} value={String(fieldValue ?? '')} onChange={(event) => update(key, event.target.value)} /> : <><input type="range" min={spec.minimum} max={spec.maximum} step={hints?.step ?? spec.multipleOf ?? 1} value={Number(fieldValue)} onChange={(event) => update(key, Number(event.target.value))} /><input className="number-input" type="number" min={spec.minimum} max={spec.maximum} step={hints?.step ?? spec.multipleOf ?? 1} value={Number(fieldValue)} onChange={(event) => update(key, Number(event.target.value))} /><span>{hints?.unit}</span></>}
        </div>
        {keyframable && <div className="keyframe-strip"><button className={hasKey ? 'key-active' : ''} title={hasKey ? '删除当前帧关键帧' : '在当前帧添加关键帧'} onClick={() => toggleKeyframe(key)}>◆</button><div className="keyline">{points.map((point) => <i key={point.frame} style={{left: `${point.frame / (document.config.timeline.durationInFrames - 1) * 100}%`}} title={`第 ${point.frame} 帧：${point.value}`} />)}</div><small>{points.length}</small></div>}
      </div>;
    })}</section>)}</div>
  </div>;
};

const SetupWizard = ({project, onDone}: {project: ProjectInfo; onDone: () => Promise<void> | void}) => {
  const [draft, setDraft] = useState<SetupDraft>();
  const [error, setError] = useState<string>();
  if (!draft) return <div className="setup-card panel"><span className="eyebrow">PARAMETER ONBOARDING</span><h2>让这个工程支持参数与关键帧编辑</h2><p>选择工程内的 JSON。软件会推断字段并生成随工程保存的清单与 Schema，不会移动原文件。</p><button className="primary" onClick={async () => {try {const next = await window.remotionManager.settings.beginSetup(project.id); if (next) setDraft(next);} catch (reason) {setError(errorMessage(reason));}}}>选择参数 JSON</button>{error && <p className="inline-error">{error}</p>}</div>;
  return <div className="stack"><section className="panel setup-form"><div className="form-grid"><label>合成项 ID<input value={draft.compositionId} onChange={(event) => setDraft({...draft, compositionId:event.target.value})} /></label><label>帧率<input type="number" value={draft.fps} onChange={(event) => setDraft({...draft, fps:Number(event.target.value)})} /></label><label>总帧数<input type="number" value={draft.durationInFrames} onChange={(event) => setDraft({...draft, durationInFrames:Number(event.target.value)})} /></label></div></section><section className="panel"><div className="panel-heading"><h2>确认可编辑字段</h2><small>{draft.settingsRelativePath}</small></div><div className="setup-table"><div className="setup-head"><span>字段</span><span>显示名称</span><span>最小</span><span>最大</span><span>步长</span><span>关键帧</span></div>{draft.fields.map((field,index) => <div className="setup-row" key={field.key}><code>{field.key}</code><input value={field.title} onChange={(event) => setDraft({...draft,fields:draft.fields.map((item,i)=>i===index?{...item,title:event.target.value}:item)})} /><input disabled={field.type==='boolean'||field.type==='string'} type="number" value={field.minimum ?? ''} onChange={(event) => setDraft({...draft,fields:draft.fields.map((item,i)=>i===index?{...item,minimum:Number(event.target.value)}:item)})} /><input disabled={field.type==='boolean'||field.type==='string'} type="number" value={field.maximum ?? ''} onChange={(event) => setDraft({...draft,fields:draft.fields.map((item,i)=>i===index?{...item,maximum:Number(event.target.value)}:item)})} /><input disabled={field.type==='boolean'||field.type==='string'} type="number" value={field.step ?? ''} onChange={(event) => setDraft({...draft,fields:draft.fields.map((item,i)=>i===index?{...item,step:Number(event.target.value)}:item)})} /><input type="checkbox" disabled={field.type==='boolean'||field.type==='string'} checked={field.keyframable} onChange={(event) => setDraft({...draft,fields:draft.fields.map((item,i)=>i===index?{...item,keyframable:event.target.checked}:item)})} /></div>)}</div><div className="footer-actions"><button onClick={()=>setDraft(undefined)}>取消</button><button className="primary" onClick={async()=>{try{await window.remotionManager.settings.completeSetup(project.id,draft);await onDone();}catch(reason){setError(errorMessage(reason));}}}>保存到工程</button></div>{error&&<p className="inline-error">{error}</p>}</section></div>;
};

const StudioPanel = ({project}: {project: ProjectInfo}) => {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let active = true;
    const show = async () => {try {await window.remotionManager.studio.show(project.id, getBounds(element));} catch (reason) {if(active)setError(errorMessage(reason));}};
    void show();
    const observer = new ResizeObserver(() => void window.remotionManager.studio.setBounds(getBounds(element)));
    observer.observe(element);
    const onWindow = () => void window.remotionManager.studio.setBounds(getBounds(element));
    window.addEventListener('resize', onWindow);
    return () => {active=false;observer.disconnect();window.removeEventListener('resize',onWindow);void window.remotionManager.studio.hide();};
  }, [project.id]);
  return <div className="studio-shell"><div className="studio-bar"><span><i className="status-dot ok" />本机隔离预览</span><button onClick={() => void window.remotionManager.studio.openExternal(project.id)}>在浏览器打开 ↗</button></div>{error && <div className="inline-error">{error}</div>}<div ref={host} className="studio-host"><div className="studio-loading">正在启动 Remotion Studio…</div></div></div>;
};

const TasksPanel = ({project,tasks,logs,run,stop}:{project:ProjectInfo;tasks:TaskState[];logs:Record<string,string>;run:(kind:TaskKind)=>void;stop:(kind:TaskKind)=>void}) => {
  const [selectedKind,setSelectedKind]=useState<TaskKind>('studio');
  const kinds:TaskKind[]=['studio','check','render','still','install'];
  const current=tasks.find((task)=>task.projectId===project.id&&task.kind===selectedKind);
  return <div className="task-layout"><section className="panel task-list">{kinds.map((kind)=>{const state=tasks.find((task)=>task.projectId===project.id&&task.kind===kind);const available=kind==='install'||kind==='studio'||kind==='check'||Boolean(project.scripts[kind as keyof typeof project.scripts]);return <button key={kind} className={selectedKind===kind?'active':''} onClick={()=>setSelectedKind(kind)}><span className={`status-dot ${state?.status==='running'?'ok':state?.status==='failed'?'bad':'muted'}`} /><span><strong>{taskLabels[kind]}</strong><small>{state?.status??(available?'可运行':'未配置')}</small></span></button>;})}</section><section className="panel terminal-panel"><div className="panel-heading"><div><span className="eyebrow">TASK OUTPUT</span><h2>{taskLabels[selectedKind]}</h2></div><div><button disabled={current?.status==='running'} onClick={()=>run(selectedKind)}>运行</button><button disabled={current?.status!=='running'} onClick={()=>stop(selectedKind)}>停止</button></div></div><pre>{logs[`${project.id}:${selectedKind}`]||'等待任务输出…'}</pre></section></div>;
};

const PersistencePanel = ({project}:{project:ProjectInfo}) => {
  const [result,setResult]=useState<VerificationResult>();
  const [running,setRunning]=useState(false);
  const [error,setError]=useState<string>();
  const verify=async()=>{setRunning(true);setError(undefined);try{setResult(await window.remotionManager.settings.verify(project.id));}catch(reason){setError(errorMessage(reason));}finally{setRunning(false);}};
  return <div className="stack"><section className="panel verification-hero"><div><span className="eyebrow">CLOSE → RESTART → RESTORE</span><h2>验证工程不是靠“上次还开着”</h2><p>记录参数哈希与关键帧，停止 Studio，重新枚举合成项并启动预览，最后把报告写回源工程。</p></div><button className="primary" disabled={running} onClick={verify}>{running?'正在完成关闭后恢复…':'一键持久化验证'}</button></section>{error&&<div className="inline-error">{error}</div>}{result&&<section className={`panel verification-result ${result.ok?'pass':'fail'}`}><div className="result-badge">{result.ok?'通过':'失败'}</div><h2>{result.ok?'工程可以完整恢复':'恢复验证发现问题'}</h2><div className="verification-grid"><div><small>参数哈希</small><code>{result.beforeHash??'无参数清单'}</code><code>{result.afterHash??'无参数清单'}</code></div><div><small>轨道 / 关键帧</small><strong>{result.keyframeTracks??0} / {result.keyframes??0}</strong></div><div><small>Studio</small><strong>{result.studioUrl??'未启动'}</strong></div><div><small>记录文件</small><strong>{result.reportPath}</strong></div></div>{result.errors.map(item=><p className="inline-error" key={item}>{item}</p>)}</section>}<section className="panel checklist"><h2>交付内容检查</h2>{[['源码入口',Boolean(project.entry)],['依赖锁文件',project.hasPackageLock],['本地 Remotion CLI',project.hasRemotionCli],['项目参数清单',project.hasManifest],['持久化参数 JSON',Boolean(project.settings)]].map(([name,ok])=><div key={String(name)}><span className={`status-dot ${ok?'ok':'warn'}`} />{name}<strong>{ok?'已具备':'待补充'}</strong></div>)}</section></div>;
};
