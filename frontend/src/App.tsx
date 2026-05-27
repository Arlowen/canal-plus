import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import {
  ArrowsClockwise,
  CheckCircle,
  Database,
  Plus,
  ShieldCheck,
  SignOut,
  WarningCircle,
  XCircle
} from "@phosphor-icons/react";
import { Button, TextInput } from "./components/ui";
import {
  api,
  checkBackendHealth,
  clearToken,
  getToken,
  isServiceUnavailableError,
  setToken,
  subscribeBackendAvailability
} from "./lib/api";
import { cx, formatDateTime } from "./lib/format";
import { canManageConfig } from "./lib/permissions";
import type { Datasource, DatasourceStatus, User } from "./types/api";

type NoticeTone = "success" | "error" | "warning";

type Notice = {
  tone: NoticeTone;
  message: string;
};

type DatasourceForm = {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  defaultSchema: string;
};

const emptyDatasourceForm: DatasourceForm = {
  name: "",
  host: "",
  port: 3306,
  username: "",
  password: "",
  defaultSchema: ""
};

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(", ");

function App() {
  const [tokenState, setTokenState] = useState(getToken());
  const [user, setUser] = useState<User | null>(null);
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<DatasourceForm>({ ...emptyDatasourceForm });
  const [submitting, setSubmitting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [serviceUnavailable, setServiceUnavailable] = useState(false);
  const [serviceRecoveryPending, setServiceRecoveryPending] = useState(false);
  const previousServiceUnavailable = useRef(false);
  const canManage = canManageConfig(user);

  const refresh = useCallback(async (quiet = false) => {
    if (!getToken()) return;
    if (!quiet) setLoading(true);
    setGlobalError(null);
    try {
      const nextDatasources = await api.datasources();
      setDatasources(nextDatasources);
      setSelectedId((current) => {
        if (current && nextDatasources.some((item) => item.id === current)) {
          return current;
        }
        return nextDatasources[0]?.id ?? null;
      });
    } catch (requestError) {
      if (isServiceUnavailableError(requestError)) {
        return;
      }
      setGlobalError(requestError instanceof Error ? requestError.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const restoreAuthenticatedState = useCallback(async () => {
    if (!getToken()) return;
    try {
      const nextUser = await api.me();
      setUser(nextUser);
      await refresh(true);
    } catch (requestError) {
      if (isServiceUnavailableError(requestError)) {
        return;
      }
      clearToken();
      setTokenState(null);
      setUser(null);
      setSelectedId(null);
    }
  }, [refresh]);

  const retryServiceConnection = useCallback(async () => {
    setServiceRecoveryPending(true);
    try {
      await checkBackendHealth();
      await restoreAuthenticatedState();
    } finally {
      setServiceRecoveryPending(false);
    }
  }, [restoreAuthenticatedState]);

  useEffect(() => subscribeBackendAvailability((available) => {
    setServiceUnavailable(!available);
    if (available) {
      setGlobalError(null);
    }
  }), []);

  useEffect(() => {
    if (!tokenState) return;
    void restoreAuthenticatedState();
  }, [restoreAuthenticatedState, tokenState]);

  useEffect(() => {
    if (!tokenState || serviceUnavailable) return;
    const timer = window.setInterval(() => {
      void refresh(true);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [refresh, serviceUnavailable, tokenState]);

  useEffect(() => {
    void checkBackendHealth().catch(() => undefined);
    const timer = window.setInterval(() => {
      void checkBackendHealth().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (previousServiceUnavailable.current && !serviceUnavailable && tokenState) {
      void restoreAuthenticatedState();
    }
    previousServiceUnavailable.current = serviceUnavailable;
  }, [restoreAuthenticatedState, serviceUnavailable, tokenState]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const handleLogin = async (username: string, password: string) => {
    const response = await api.login({ username, password });
    setToken(response.token);
    setTokenState(response.token);
    setUser(response.user);
  };

  const handleLogout = () => {
    clearToken();
    setTokenState(null);
    setUser(null);
    setSelectedId(null);
    setNotice(null);
  };

  const openCreator = () => {
    if (!canManage) {
      setNotice({ tone: "warning", message: "需要管理员权限" });
      return;
    }
    setForm({ ...emptyDatasourceForm });
    setModalOpen(true);
  };

  const createDatasource = async (testAfterCreate: boolean) => {
    if (!canManage) {
      setNotice({ tone: "warning", message: "需要管理员权限" });
      return;
    }
    const validationError = validateDatasourceForm(form);
    if (validationError) {
      setNotice({ tone: "warning", message: validationError });
      return;
    }

    setSubmitting(true);
    try {
      const created = await api.createDatasource(form);
      setSelectedId(created.id);
      setModalOpen(false);
      setForm({ ...emptyDatasourceForm });

      if (testAfterCreate) {
        setTestingId(created.id);
        const tested = await api.testDatasource(created.id);
        setNotice({
          tone: tested.connectionStatus === "online" ? "success" : "warning",
          message: tested.lastTestMessage || "测试完成"
        });
      } else {
        setNotice({ tone: "success", message: "已添加" });
      }

      await refresh(true);
    } catch (requestError) {
      setNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "添加失败" });
    } finally {
      setSubmitting(false);
      setTestingId(null);
    }
  };

  const handleCreateSubmit = (event: FormEvent) => {
    event.preventDefault();
    void createDatasource(false);
  };

  const testDatasource = async (item: Datasource) => {
    setTestingId(item.id);
    try {
      const tested = await api.testDatasource(item.id);
      setSelectedId(tested.id);
      setNotice({
        tone: tested.connectionStatus === "online" ? "success" : "warning",
        message: tested.lastTestMessage || "测试完成"
      });
      await refresh(true);
    } catch (requestError) {
      setNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "测试失败" });
    } finally {
      setTestingId(null);
    }
  };

  if (!tokenState) {
    if (serviceUnavailable) {
      return <BackendUnavailableScreen retrying={serviceRecoveryPending} onRetry={retryServiceConnection} />;
    }
    return <LoginScreen onLogin={handleLogin} />;
  }

  const visibleDatasources = datasources
    .filter((item) => !keyword.trim() || datasourceSearchText(item).includes(keyword.trim().toLowerCase()))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
  const selectedDatasource = datasources.find((item) => item.id === selectedId) ?? visibleDatasources[0] ?? null;

  return (
    <div className="min-h-[100dvh] bg-mist text-ink">
      <div className="mx-auto grid min-h-[100dvh] max-w-[1440px] gap-4 p-3 md:p-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="surface flex min-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden">
          <div className="border-b border-line px-4 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-coal text-sm font-semibold text-white">
                CP
              </div>
              <div>
                <div className="brand-wordmark" aria-label="Canal Plus">
                  <span>Canal</span>
                  <span>Plus</span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-b border-line p-3">
            <Button onClick={openCreator} disabled={!canManage} className="btn-primary w-full">
              <Plus size={16} />
              新建连接
            </Button>
            <label className="mt-3 block">
              <span className="sr-only">搜索</span>
              <span className="relative block">
                <TextInput
                  className="input h-10 pl-3"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="搜索连接"
                />
              </span>
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-2">
            {loading && datasources.length === 0 ? (
              <ConnectionListSkeleton />
            ) : visibleDatasources.length === 0 ? (
              <EmptyConnectionList canManage={canManage} onCreate={openCreator} />
            ) : (
              <div className="grid gap-1">
                {visibleDatasources.map((item) => (
                  <ConnectionListItem
                    key={item.id}
                    datasource={item}
                    active={selectedDatasource?.id === item.id}
                    onSelect={() => setSelectedId(item.id)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-line p-3">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white px-3 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-coal">{user?.name || user?.username || "User"}</div>
              </div>
              <Button onClick={handleLogout} className="btn-compact px-2.5" aria-label="退出">
                <SignOut size={16} />
              </Button>
            </div>
          </div>
        </aside>

        <main className="min-w-0">
          <section className="surface min-h-[calc(100dvh-1.5rem)] overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <h1 className="text-2xl font-semibold tracking-tight text-coal">数据源</h1>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void refresh()} className="btn-secondary">
                  <ArrowsClockwise size={16} />
                  刷新
                </Button>
                <Button onClick={openCreator} disabled={!canManage} className="btn-primary">
                  <Plus size={16} />
                  新建连接
                </Button>
              </div>
            </div>

            <div className="p-5">
              {serviceUnavailable && (
                <NoticeBanner
                  tone="warning"
                  action={(
                    <Button onClick={() => void retryServiceConnection()} disabled={serviceRecoveryPending} className="btn-compact">
                      <ArrowsClockwise size={14} />
                      {serviceRecoveryPending ? "重试中" : "重试"}
                    </Button>
                  )}
                >
                  后端不可用
                </NoticeBanner>
              )}

              {notice && (
                <NoticeBanner tone={notice.tone}>
                  {notice.message}
                </NoticeBanner>
              )}

              {globalError && (
                <NoticeBanner tone="error">
                  {globalError}
                </NoticeBanner>
              )}

              <ConnectionDetail
                datasource={selectedDatasource}
                canManage={canManage}
                testing={Boolean(selectedDatasource && testingId === selectedDatasource.id)}
                onCreate={openCreator}
                onTest={testDatasource}
              />
            </div>
          </section>
        </main>
      </div>

      <Modal
        open={modalOpen}
        title="新建连接"
        onClose={() => setModalOpen(false)}
      >
        <form onSubmit={handleCreateSubmit} className="grid gap-4">
          <Field label="名称">
            <TextInput className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_130px]">
            <Field label="主机">
              <TextInput className="input" value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} required />
            </Field>
            <Field label="端口">
              <TextInput className="input" type="number" value={form.port} onChange={(event) => setForm({ ...form, port: Number(event.target.value) })} required />
            </Field>
          </div>
          <Field label="用户">
            <TextInput className="input" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required />
          </Field>
          <Field label="密码">
            <TextInput className="input" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
          </Field>
          <Field label="数据库">
            <TextInput className="input" value={form.defaultSchema} onChange={(event) => setForm({ ...form, defaultSchema: event.target.value })} />
          </Field>
          <div className="flex flex-wrap justify-end gap-3 border-t border-line pt-4">
            <Button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">
              取消
            </Button>
            <Button type="button" onClick={() => void createDatasource(true)} disabled={submitting} className="btn-secondary">
              {submitting ? <ArrowsClockwise size={16} /> : <ShieldCheck size={16} />}
              添加并测试
            </Button>
            <Button disabled={submitting} className="btn-primary">
              {submitting ? <ArrowsClockwise size={16} /> : <CheckCircle size={16} />}
              添加
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function ConnectionListItem({
  datasource,
  active,
  onSelect
}: {
  datasource: Datasource;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      onClick={onSelect}
      className={cx(
        "flex w-full items-start justify-start gap-3 rounded-lg border px-3 py-3 text-left transition",
        active ? "border-blue-200 bg-blue-50 text-accent" : "border-transparent text-slate-700 hover:border-line hover:bg-slate-50"
      )}
    >
      <Database size={18} className="mt-0.5 shrink-0" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{datasource.name}</span>
        <span className="mt-1 block truncate font-mono text-xs text-slate-500">{datasource.host}:{datasource.port}</span>
      </span>
      <span className={cx("ml-auto mt-1 h-2 w-2 shrink-0 rounded-full", statusDotClass(datasource.connectionStatus))} />
    </Button>
  );
}

function ConnectionDetail({
  datasource,
  canManage,
  testing,
  onCreate,
  onTest
}: {
  datasource: Datasource | null;
  canManage: boolean;
  testing: boolean;
  onCreate: () => void;
  onTest: (datasource: Datasource) => void;
}) {
  if (!datasource) {
    return (
      <div className="flex min-h-[520px] items-center justify-center rounded-lg border border-dashed border-line bg-white">
        <div className="text-center">
          <Database size={28} className="mx-auto text-accent" />
          <div className="mt-4 text-lg font-semibold text-coal">无连接</div>
          {canManage && (
            <Button onClick={onCreate} className="btn-primary mt-5">
              <Plus size={16} />
              新建连接
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-4 rounded-lg border border-line bg-white p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="truncate text-2xl font-semibold tracking-tight text-coal">{datasource.name}</h2>
            <Badge tone={datasourceTone(datasource.connectionStatus)}>{datasourceStatusText(datasource.connectionStatus)}</Badge>
          </div>
          <div className="mt-2 font-mono text-sm text-slate-500">{datasource.host}:{datasource.port}</div>
        </div>
        <Button onClick={() => onTest(datasource)} disabled={testing} className="btn-primary">
          {testing ? <ArrowsClockwise size={16} /> : <ShieldCheck size={16} />}
          {testing ? "测试中" : "测试连接"}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <DetailLine label="用户" value={datasource.username} mono />
        <DetailLine label="数据库" value={datasource.defaultSchema || "-"} mono />
        <DetailLine label="地址" value={`${datasource.host}:${datasource.port}`} mono />
        <DetailLine label="最近测试" value={datasource.lastTestedAt ? formatDateTime(datasource.lastTestedAt) : "-"} />
      </div>

      {datasource.lastTestMessage && (
        <div className="rounded-lg border border-line bg-slate-50 px-4 py-3 text-sm text-slate-600">
          {datasource.lastTestMessage}
        </div>
      )}
    </div>
  );
}

function DetailLine({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="label">{label}</div>
      <div className={cx("mt-2 truncate text-sm font-medium text-coal", mono && "mono")}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-2 block">{label}</span>
      {children}
    </label>
  );
}

function EmptyConnectionList({ canManage, onCreate }: { canManage: boolean; onCreate: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-white p-5 text-center">
      <div className="text-sm font-medium text-coal">无连接</div>
      {canManage && (
        <Button onClick={onCreate} className="btn-secondary mt-4">
          <Plus size={16} />
          新建
        </Button>
      )}
    </div>
  );
}

function ConnectionListSkeleton() {
  return (
    <div className="grid gap-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="rounded-lg border border-line bg-white p-3">
          <div className="skeleton h-4 w-2/3 rounded" />
          <div className="skeleton mt-3 h-3 w-4/5 rounded" />
        </div>
      ))}
    </div>
  );
}

function NoticeBanner({
  tone,
  children,
  action
}: {
  tone: NoticeTone;
  children: ReactNode;
  action?: ReactNode;
}) {
  const className = tone === "success"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-red-200 bg-red-50 text-red-700";
  return (
    <div className={cx("mb-5 flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="flex items-start gap-2">
        {tone === "success" ? <CheckCircle size={18} /> : tone === "warning" ? <WarningCircle size={18} /> : <XCircle size={18} />}
        <div>{children}</div>
      </div>
      {action && <div className="sm:pl-4">{action}</div>}
    </div>
  );
}

function BackendUnavailableScreen({
  retrying,
  onRetry
}: {
  retrying: boolean;
  onRetry: () => Promise<void>;
}) {
  return (
    <div className="min-h-[100dvh] bg-mist px-4 py-8 text-ink">
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-xl items-center justify-center">
        <section className="surface w-full p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg border border-red-100 bg-red-50 text-red-600">
            <WarningCircle size={26} />
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-coal">后端不可用</h1>
          <div className="mt-7 flex justify-center">
            <Button onClick={() => void onRetry()} disabled={retrying} className="btn-primary min-w-32">
              <ArrowsClockwise size={16} />
              {retrying ? "重试中" : "重试"}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await onLogin(username, password);
    } catch (requestError) {
      if (isServiceUnavailableError(requestError)) {
        return;
      }
      setError(requestError instanceof Error ? requestError.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-[100dvh] place-items-center bg-[linear-gradient(135deg,#f8fbff_0%,#eff6ff_46%,#dbeafe_100%)] px-4 text-ink">
      <form onSubmit={submit} className="surface w-full max-w-[390px] p-6 md:p-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-coal text-sm font-semibold text-white">
            CP
          </div>
          <div className="brand-wordmark" aria-label="Canal Plus">
            <span>Canal</span>
            <span>Plus</span>
          </div>
        </div>
        <h1 className="mt-10 text-3xl font-semibold tracking-tight text-coal">登录</h1>

        <div className="mt-8 grid gap-5">
          <Field label="账号">
            <TextInput className="input" value={username} onChange={(event) => setUsername(event.target.value)} />
          </Field>
          <Field label="密码">
            <TextInput className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <Button disabled={loading} className="btn-primary w-full py-3.5">
            {loading ? <ArrowsClockwise size={16} /> : <CheckCircle size={16} />}
            {loading ? "登录中" : "登录"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function getFocusableElements(container: HTMLElement | null) {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => !element.hasAttribute("disabled"));
}

function Modal({
  open,
  title,
  children,
  onClose
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    lastActiveElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      const focusable = getFocusableElements(panelRef.current);
      (focusable[0] || panelRef.current)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusableElements(panelRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      lastActiveElementRef.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-8 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[90dvh] w-full max-w-2xl overflow-auto rounded-lg border border-line bg-white p-6 shadow-raised outline-none md:p-8"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-2xl font-semibold tracking-tight text-coal">{title}</h2>
          <Button onClick={onClose} className="btn-compact px-2.5" aria-label="关闭">
            <XCircle size={16} />
          </Button>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function Badge({ tone, children }: { tone: "blue" | "green" | "yellow" | "red" | "neutral"; children: ReactNode }) {
  const className = tone === "blue"
    ? "border-blue-200 bg-blue-50 text-blue-700"
    : tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "yellow"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone === "red"
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-slate-200 bg-slate-50 text-slate-600";
  return <span className={cx("chip", className)}>{children}</span>;
}

function validateDatasourceForm(form: DatasourceForm) {
  if (!form.name.trim()) return "请填写名称";
  if (!form.host.trim()) return "请填写主机";
  if (!Number.isFinite(Number(form.port)) || Number(form.port) <= 0) return "端口无效";
  if (!form.username.trim()) return "请填写用户";
  if (!form.password) return "请填写密码";
  return null;
}

function datasourceSearchText(item: Datasource) {
  return [
    item.name,
    item.host,
    item.defaultSchema,
    item.username
  ].filter(Boolean).join(" ").toLowerCase();
}

function datasourceStatusText(value: DatasourceStatus) {
  if (value === "online") return "在线";
  if (value === "offline") return "离线";
  return "未测试";
}

function datasourceTone(value: DatasourceStatus) {
  if (value === "online") return "green";
  if (value === "offline") return "red";
  return "neutral";
}

function statusDotClass(value: DatasourceStatus) {
  if (value === "online") return "bg-emerald-500";
  if (value === "offline") return "bg-red-500";
  return "bg-slate-300";
}

export default App;
