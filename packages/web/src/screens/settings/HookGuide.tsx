// 훅 설치 안내 (01 문서 10장): 수집기 연결 상태 + 예시 .claude/settings.json + 복사 버튼. 설정 화면과 마을이 없을 때의 빈 화면
import { useState } from 'react';
import example from '../../../../../examples/target-project/.claude/settings.json?raw';
import { t } from '../../i18n';
import { Icon } from '../../icons/Icon';
import { Button, StatusChip } from '../../ui';
import './settings.css';

/** 예시 훅이 보내는 주소 (수집기 기본 :4777) */
export const HOOK_URL = /http:\/\/[^\s'"]+\/hook/.exec(example)?.[0] ?? '';

export function HookGuide({ connected }: { connected: boolean }) {
  const [msg, setMsg] = useState('');
  const copy = () =>
    navigator.clipboard.writeText(example).then(
      () => setMsg(t('hooks.copied')),
      () => setMsg(t('hooks.copyFailed')),
    );
  return (
    <div className="hg">
      <p className="hg__row">
        <span>{t('hooks.collector')}</span>
        {/* 상태 = 색 + 아이콘. 칩 전체를 칠하면 대비가 모자라 원만 칠한다 (끊김 칩과 같음) */}
        <StatusChip
          status={connected ? 'resting' : 'blocked'}
          icon={<Icon name={connected ? 'done' : 'blocked'} size={12} />}
        >
          {t(connected ? 'hooks.connected' : 'hooks.disconnected')}
        </StatusChip>
        <span className="hg__url">{t('hooks.url', { url: HOOK_URL })}</span>
      </p>
      <ol className="hg__steps">
        <li>{t('hooks.step1')}</li>
        <li>{t('hooks.manual')}</li>
        <li>{t('hooks.step2')}</li>
      </ol>
      <pre className="hg__code" tabIndex={0} aria-label={t('hooks.code')}>
        <code>{example}</code>
      </pre>
      <p className="hg__row">
        <Button size="m" onClick={() => void copy()}>
          {t('hooks.copy')}
        </Button>
        <span role="status" className="hg__msg">
          {msg}
        </span>
      </p>
      <p className="hg__note">{t('hooks.async')}</p>
    </div>
  );
}
