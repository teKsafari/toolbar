// @open-toolbar/embed/react: the toolbar as a React component (D-211). It renders nothing and
// starts the toolbar in an effect, so server rendering never touches window.
//   <OpenToolbar siteKey="tbk_..." server="https://toolbar.example.com" user={{ name }} />
import { useEffect } from 'react';
import { init, type InitOptions } from './init.ts';

export interface OpenToolbarProps {
  /** the project's embed key, `tbk_...` */
  siteKey: string;
  /** the open-toolbar server */
  server: string;
  user?: InitOptions['user'];
}

export function OpenToolbar({ siteKey, server, user }: OpenToolbarProps): null {
  const name = user?.name;
  const email = user?.email;
  useEffect(() => {
    init({ key: siteKey, server, user: { name, email } });
  }, [siteKey, server, name, email]);
  return null;
}

export { init, type InitOptions };
