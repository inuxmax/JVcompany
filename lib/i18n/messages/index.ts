// Gộp các nhóm bản dịch. Mỗi nhóm ứng với một vùng giao diện để nhiều người sửa song song không đụng nhau.
// Câu trùng giữa các nhóm: nhóm đứng trước được ưu tiên.
import type { Catalog } from '../locales';
import common from './common';
import shell from './shell';
import catalog from './catalog';
import providers from './providers';
import office from './office';
import building from './building';
import guide from './guide';
import projects from './projects';
import company from './company';
import workspace from './workspace';
import settings from './settings';
import server from './server';
import chat from './chat';
import codegraph from './codegraph';
import connections from './connections';

export const CATALOGS: Catalog[] = [common, shell, catalog, providers, office, building, guide, projects, company, workspace, settings, server, chat, codegraph, connections]
