import '@gershy/clearing';

export type NetProc = { proto: 'ws' | 'wss' | 'http' | 'https', addr: string, port: number };

type Built<T> = T | { [K: string]: Built<T> };

export type HttpMethod = 'head' | 'get' | 'post' | 'put' | 'patch' | 'delete';
export type HttpInp = {
  fetch?: typeof fetch,
  netProc: NetProc,
  path: string[],
  method: HttpMethod,
  headers?: Obj<string>,
  cookies?: Obj<Built<string>>,
  query?: Obj<Built<string>>,
  body?: Json // Want to add `| Uint8Array` but HttpCaller has an arbitrary `httpInp` member prop which it wants to be able to jsfn encode... add Uint8Array handling to jsfn??
};
export default <ResBody>(inp: HttpInp) => {
  
  // Note this function is sovereign - can't reference jargon/http for `formatNetProc` :(
  const { fetch: fetcher = fetch } = inp;
  const { netProc, path, headers={} } = inp;
  const { query = {}, body: reqBody = null } = inp;
  
  const defPorts = { http: 80, https: 443 };
  const url = [
    
    // E.g. "http://pasta.com"
    `${netProc.proto}:/${''}/${netProc.addr}`,
    
    // E.g. "http://pasta.com:3000"
    netProc.port !== defPorts[netProc.proto] ? `:${netProc.port.toString(10)}` : null,
    
    // E.g. "http://pasta.com:3000/path/to/resource"
    path ? `/${path.join('/')}` : null,
    
    (() => {
      
      if (query[cl.empty]()) return null;
      
      const chains = function*(val: any, chain: string[] = []): Generator<{ chain: string[], val }> {
        if (!cl.isCls(val, Object)) return yield { chain, val };
        for (const [ k, v ] of val[cl.walk]()) yield* chains(v, [ ...chain, k ]);
      };
      
      // E.g. "http://pasta.com:3000/path/to/resource?query=spaghetti&offset=10"
      const pcs = [ ...chains(query) ];
      return pcs.length > 0
        ? '?' + pcs[cl.map](({ chain, val }) => `${encodeURIComponent(chain.join('.'))}=${encodeURIComponent(val)}`).join('&')
        : '';
      
    })()
    
  ].filter(Boolean).join('');
  
  const reqArgs = {
    method: inp.method[cl.upper](),
    headers: headers
      [cl.toArr]((v, k) => [ k.replace(/([A-Z])/g, '-$1')[cl.lower](), v ] as [ string, string ]), // Avoid `camelCase` util - want to keep this sovereign
    body: [ Object, Array ].some(C => cl.isCls(reqBody, C)) ? JSON.stringify(reqBody) : reqBody !== null ? `${reqBody}` : null
  };
  
  const err = new Error('');
  const abort = new AbortController();
  const prm = fetcher(url, { ...reqArgs, signal: abort.signal }).then(
    async res => {
      
      const resBody = await (async () => {
        const t = new Uint8Array(await res.arrayBuffer());
        try { return JSON.parse(t[cl.toStr]()) as Json; } catch(err) {}
        return t;
      })();
      
      const http = {
        reqArgs: Object.assign(reqArgs, { url, body: reqBody }) as (typeof reqArgs & { url: string }),
        code: res.status,
        body: resBody as ResBody
      };
      
      if (res.status >= 500) throw Error('http glitch')[cl.mod](http);
      if (res.status >= 400) throw Error('http reject')[cl.mod](http);
      return http; // TODO: Return something like `{ ...http.body, http: { status: res.status } }`? Works as long as `http.body` is Json and not a Buffer
      
    },
    cause => {
      while (cl.isCls(cause.cause, Error)) cause = cause.cause; // `fetch` natively wraps errors - pretty annoying; unwrap them
      if (cause.code === 'ENOTFOUND') return err[cl.fire]({ cause, reqArgs, retry: false });
      return err[cl.fire]({ cause, reqArgs });
    }
  );
  
  // Note that fetch abortion errors are suppressed!! By default we short-circuit any logic
  // which depended on the http return value, all the way up to the top-level handler which
  // interprets the suppressed error
  return Object.assign(prm, { end: () => abort.abort(Error('fetch aborted')[cl.suppress]()) });
  
};