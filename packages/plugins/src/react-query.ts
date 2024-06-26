import { lodash, winPath } from '@umijs/utils';
import { dirname, join } from 'path';
import { IApi } from 'umi';
import { isFlattedNodeModulesDir } from './utils/npmClient';
import { resolveProjectDep } from './utils/resolveProjectDep';
import { withTmpPath } from './utils/withTmpPath';

export default (api: IApi) => {
  api.describe({
    key: 'reactQuery',
    config: {
      schema({ zod }) {
        return zod
          .object({
            devtool: zod.union([zod.record(zod.any()), zod.boolean()]),
            queryClient: zod.union([zod.record(zod.any()), zod.boolean()]),
          })
          .deepPartial();
      },
    },
    enableBy: api.EnableBy.config,
  });

  let pkgPath: string;
  let devtoolsPkgPath: string;
  const REACT_QUERY_DEP_NAME = '@tanstack/react-query';
  const REACT_QUERY_DEVTOOLS_DEP_NAME = '@tanstack/react-query-devtools';
  const defaultPkgPath = winPath(
    dirname(require.resolve(`${REACT_QUERY_DEP_NAME}/package.json`)),
  );
  const defaultDevtoolPkgPath = winPath(
    dirname(require.resolve(`${REACT_QUERY_DEVTOOLS_DEP_NAME}/package.json`)),
  );
  // resolve RQ
  try {
    const localQueryPath = resolveProjectDep({
      pkg: api.pkg,
      cwd: api.cwd,
      dep: REACT_QUERY_DEP_NAME,
    });
    pkgPath = localQueryPath ? winPath(localQueryPath) : defaultPkgPath;
  } catch (e: any) {
    throw new Error(
      `[reactQuery] package '${REACT_QUERY_DEP_NAME}' resolve failed, ${e.message}`,
    );
  }
  // resolve RQ devtools
  try {
    const localDevtoolsPkgPath = resolveProjectDep({
      pkg: api.pkg,
      cwd: api.cwd,
      dep: REACT_QUERY_DEVTOOLS_DEP_NAME,
    });
    devtoolsPkgPath = localDevtoolsPkgPath
      ? winPath(localDevtoolsPkgPath)
      : defaultDevtoolPkgPath;
  } catch (e: any) {
    throw new Error(
      `[reactQuery] package '${REACT_QUERY_DEVTOOLS_DEP_NAME}' resolve failed, ${e.message}`,
    );
  }
  // package.json
  const pkg = require(join(pkgPath, 'package.json'));
  const devtoolsPkg = require(join(devtoolsPkgPath, 'package.json'));
  // version
  const pkgVersion = pkg.version;
  const devtoolsVersion = devtoolsPkg.version;
  // check version
  const useV4 = pkgVersion.startsWith('4');
  const useV4Devtools = devtoolsVersion.startsWith('4');
  const useV5 = pkgVersion.startsWith('5');
  const useV5Devtools = devtoolsVersion.startsWith('5');
  const canUseDevtools = (useV4 && useV4Devtools) || (useV5 && useV5Devtools);

  api.onStart(() => {
    if (pkgPath !== defaultPkgPath && !process.env.IS_UMI_BUILD_WORKER) {
      api.logger.info(`[reactQuery] use local package, version: ${pkgVersion}`);
    }
  });

  api.addRuntimePlugin(() => {
    return [withTmpPath({ api, path: 'runtime.tsx' })];
  });

  api.addRuntimePluginKey(() => {
    return ['reactQuery'];
  });

  // alias
  api.modifyConfig((memo) => {
    memo.alias[REACT_QUERY_DEP_NAME] = pkgPath;
    if (canUseDevtools) {
      memo.alias[REACT_QUERY_DEVTOOLS_DEP_NAME] = devtoolsPkgPath;
    }
    return memo;
  });

  api.onGenerateFiles(() => {
    const enableDevTools =
      api.config.reactQuery.devtool !== false && canUseDevtools;
    const enableQueryClient = api.config.reactQuery.queryClient !== false;
    const reactQueryRuntimeCode = api.appData.appJS?.exports.includes(
      'reactQuery',
    )
      ? `import { reactQuery as reactQueryConfig } from '@/app';`
      : `const reactQueryConfig = {};`;
    api.writeTmpFile({
      path: 'runtime.tsx',
      content: enableQueryClient
        ? `
import React from 'react';
import {
  ${useV4 ? 'defaultContext,' : ''}
  QueryClient,
  QueryClientProvider
} from '${pkgPath}';
${
  enableDevTools
    ? `import { ReactQueryDevtools } from '${devtoolsPkgPath}';`
    : ''
}
${reactQueryRuntimeCode}
const client = new QueryClient(reactQueryConfig.queryClient || {});
export function rootContainer(container) {
  return (
    <QueryClientProvider
      client={client}
      ${useV4 ? 'context={defaultContext}' : ''}
    >
      {container}
      ${
        enableDevTools
          ? `<ReactQueryDevtools
  ${useV4 ? 'context={defaultContext}' : ''}
  initialIsOpen={false}
  {...(reactQueryConfig.devtool || {})}
/>`
          : ''
      }
    </QueryClientProvider>
  );
}
      `
        : 'export {}',
    });

    const exportMembers: string[] = [
      // from @tanstack/query-core
      'QueryClient',
      'QueryCache',
      'MutationCache',
      'QueryObserver',
      'InfiniteQueryObserver',
      'QueriesObserver',
      'MutationObserver',
      // from @tanstack/react-query
      'useQuery',
      'useQueries',
      'useInfiniteQuery',
      'useMutation',
      'useIsFetching',
      'useIsMutating',
      ...(useV5
        ? [
            'useMutationState',
            'useSuspenseQuery',
            'useSuspenseInfiniteQuery',
            'useSuspenseQueries',
            'queryOptions',
            'infiniteQueryOptions',
          ]
        : []),
      'QueryClientProvider',
      'useQueryClient',
      'QueryErrorResetBoundary',
      'useQueryErrorResetBoundary',
      'useIsRestoring',
      'IsRestoringProvider',
    ].filter(Boolean);

    api.writeTmpFile({
      path: 'index.tsx',
      content: `
export {
  ${exportMembers.join(',\n  ')}
} from '${pkgPath}';
      `,
    });

    const exportTypes: string[] = [
      // from @tanstack/query-core
      'Query',
      'QueryState',
      'Mutation',
      // from @tanstack/react-query
      'QueriesResults',
      'QueriesOptions',
      'QueryErrorResetBoundaryProps',
      'QueryClientProviderProps',
      useV4 && 'ContextOptions as QueryContextOptions,',
      'UseQueryOptions',
      'UseBaseQueryOptions',
      'UseQueryResult',
      'UseBaseQueryResult',
      'UseInfiniteQueryOptions',
      'UseMutationResult',
      'UseMutateFunction',
      'UseMutateAsyncFunction',
      'UseBaseMutationResult',
    ].filter(Boolean);

    api.writeTmpFile({
      path: 'types.d.ts',
      content: `
export type {
  ${exportTypes.join(',\n  ')}
} from '${pkgPath}';
      `,
    });

    api.writeTmpFile({
      path: 'types.d.ts',
      content: enableQueryClient
        ? `
import React from 'react';
import { QueryClientConfig } from '${pkgPath}';
${
  enableDevTools
    ? `
import { ReactQueryDevtools } from '${devtoolsPkgPath}';
`
    : ''
}

export type RuntimeReactQueryType = {
  ${
    enableDevTools
      ? `
  devtool?: React.ComponentProps<typeof ReactQueryDevtools>
`
      : ''
  }
  queryClient?: QueryClientConfig
}`
        : 'export type RuntimeReactQueryType = {}',
    });
  });

  // v5
  const isFlattedDepsDir = isFlattedNodeModulesDir(api);
  if (useV5 && !isFlattedDepsDir) {
    let corePath: string;
    const REACT_QUERY_CORE_DEP_NAME = '@tanstack/query-core';

    // resolve RQ core
    try {
      corePath = winPath(
        dirname(
          require.resolve(`${REACT_QUERY_CORE_DEP_NAME}/package.json`, {
            paths: [pkgPath],
          }),
        ),
      );
    } catch (e: any) {
      throw new Error(
        `[reactQuery] package '${REACT_QUERY_CORE_DEP_NAME}' resolve failed, ${e.message}`,
      );
    }

    api.modifyTSConfig((config) => {
      // if without the source of `@tanstack/query-core`, the IDE can't find the types
      lodash.set(
        config,
        `compilerOptions.paths["${REACT_QUERY_CORE_DEP_NAME}"]`,
        [corePath],
      );
      return config;
    });
  }
};
