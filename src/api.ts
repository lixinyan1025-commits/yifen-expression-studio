export async function api<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json', 'X-Yifen-Request': '1' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(path === 'status' ? 5000 : path === 'vault' ? 12000 : 150000),
    });
  } catch {
    throw new Error('网络连接中断或请求超时。请确认本地服务仍在运行，录音可保留后重试。');
  }
  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new Error('本地服务返回异常，请重启网站服务后重试。');
  }
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data as T;
}
export function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = reject;
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.readAsDataURL(blob);
  });
}
