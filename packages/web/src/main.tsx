import '../../../design/tokens.css';
import '../../../design/tokens-sea.css';
import './base.css';
import { createRoot } from 'react-dom/client';
import { Gallery } from './dev/Gallery';
import { Characters } from './dev/Characters';
import { Icons } from './dev/Icons';
import { Ui } from './dev/Ui';
import { VillageDemo } from './dev/VillageDemo';
import { LiveApp } from './screens/LiveApp';

// ponytail: 라우터 없이 경로 분기. 상세 화면(M6~)이 경로를 갖게 되면 라우터 검토.
const pages: Record<string, React.ComponentType> = {
  '/': LiveApp,
  '/dev/gallery': Gallery,
  '/dev/icons': Icons,
  '/dev/ui': Ui,
  '/dev/characters': Characters,
  '/dev/village': VillageDemo,
};
const el = document.body.appendChild(document.createElement('div'));
const Page = pages[location.pathname];
createRoot(el).render(Page ? <Page /> : null);
