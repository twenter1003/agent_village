// 수집기 API (02 문서 9장). vite가 '/api'를 수집기로 넘긴다. SSE는 바뀔 때마다 'state' 전체 스냅샷,
// 접속 때·마을 설정이 바뀔 때 그 앞에 'config' (수집기가 투영에 쓰는 병합된 GameConfig).
import { useEffect, useState } from 'react';
import { defaultConfig, type GameConfig, type VillageState } from '@tycoon/core';

export interface ProjectInfo {
  id: string;
  cwd: string;
  lastAt: number;
}

const base = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return (await r.json()) as T;
}

export const fetchProjects = () => get<ProjectInfo[]>('/api/projects');
export const fetchState = (id: string) => get<VillageState>(`${base(id)}/state`);

export const RETRY_MS = 3000;

/**
 * SSE 구독. 반환값 = 구독 끊기.
 * 잠깐 끊기면 EventSource가 스스로 다시 붙는다. 하지만 수집기가 꺼지면 (1) 프록시가 502/500을 줘서 CLOSED로 멈추거나
 * (2) vite 프록시 뒤라 연결이 열린 채 조용해진다 (': ping' 주석은 JS에서 안 보임). 그래서 RETRY_MS마다 수집기에 물어보고
 * 죽었으면 끊고, 살아났는데 연결이 없으면 새로 연다 (첫 프레임이 전체 스냅샷).
 */
export function subscribeVillage(
  id: string,
  onState: (s: VillageState) => void,
  onConnected: (on: boolean) => void,
  onConfig: (c: GameConfig) => void = () => {},
): () => void {
  let es: EventSource | null = null;
  let stopped = false;
  const drop = () => {
    es?.close();
    es = null;
  };
  const open = () => {
    const src = new EventSource(`${base(id)}/stream`);
    es = src;
    src.onopen = () => onConnected(true);
    src.addEventListener('state', (e) => {
      try {
        onState(JSON.parse((e as MessageEvent<string>).data) as VillageState);
        onConnected(true);
      } catch {
        // 깨진 프레임은 버리고 다음 스냅샷을 기다린다
      }
    });
    src.addEventListener('config', (e) => {
      try {
        onConfig(JSON.parse((e as MessageEvent<string>).data) as GameConfig);
      } catch {
        // 깨지면 쓰던 설정 그대로
      }
    });
    src.onerror = () => {
      onConnected(false);
      if (src.readyState === EventSource.CLOSED && es === src) drop(); // 다음 확인 때 다시 연다
    };
  };
  const check = async () => {
    const up = await fetch('/api/projects').then(
      (r) => r.ok,
      () => false,
    );
    if (stopped) return;
    if (!up) {
      drop();
      onConnected(false);
    } else if (!es) open();
  };
  open();
  const timer = setInterval(() => void check(), RETRY_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
    drop();
  };
}

/** 마을 하나의 실시간 상태와 설정. 끊겨도 마지막 상태는 그대로 두고 connected만 false.
 *  설정은 첫 config 전까지 기본값 (tycoon.json overrides가 없으면 같다) */
export function useVillage(projectId: string | null) {
  const [state, setState] = useState<VillageState | null>(null);
  const [cfg, setCfg] = useState<GameConfig>(defaultConfig);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    setState(null);
    setCfg(defaultConfig);
    setConnected(false);
    if (!projectId) return;
    return subscribeVillage(projectId, setState, setConnected, setCfg);
  }, [projectId]);
  return { state, cfg, connected };
}
