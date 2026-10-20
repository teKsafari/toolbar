// @open-toolbar/embed/react: the toolbar as a React component (D-211). It renders nothing and
// starts the toolbar in an effect, so server rendering never touches window. The build puts
// 'use client' at the top of dist/react.js (vite.esm.config.ts), so a React Server Components app
// can render it from a server component.
//   <OpenToolbar siteKey="tbk_..." server="https://toolbar.example.com" user={{ name }} />
import { useEffect, useRef } from 'react';
import { init, setUser, type InitOptions, type ReviewerUser } from './init.ts';

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
  const started = useRef(false);
  useEffect(() => {
    // the toolbar starts once per page; a user who signs in or out later renames the reviewer
    if (started.current) setUser({ name, email });
    else {
      started.current = true;
      init({ key: siteKey, server, user: { name, email } });
    }
  }, [siteKey, server, name, email]);
  return null;
}

export { init, setUser, type InitOptions, type ReviewerUser };
