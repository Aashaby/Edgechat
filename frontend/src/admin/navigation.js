import { Database, Gauge, Send, Settings, UserCog, UserPlus, Wrench } from '@lucide/vue';

export const adminNavigation = [
  {
    id: 'dashboard',
    labelKey: 'admin.nav.dashboard',
    descriptionKey: 'admin.nav.dashboardDescription',
    to: '/admin/dashboard',
    icon: Gauge
  },
  {
    id: 'users',
    labelKey: 'admin.nav.users',
    descriptionKey: 'admin.nav.usersDescription',
    to: '/admin/users',
    icon: UserCog
  },
  {
    id: 'storage',
    labelKey: 'admin.nav.storage',
    descriptionKey: 'admin.nav.storageDescription',
    to: '/admin/storage',
    icon: Database
  },
  {
    id: 'invites',
    labelKey: 'admin.nav.invites',
    descriptionKey: 'admin.nav.invitesDescription',
    to: '/admin/invites',
    icon: UserPlus,
    children: [
      { id: 'create-user', labelKey: 'admin.nav.createUser', hash: '#create-user' },
      { id: 'registration-links', labelKey: 'admin.nav.registrationLinks', hash: '#registration-links' }
    ]
  },
  {
    id: 'telegram',
    labelKey: 'admin.nav.telegram',
    descriptionKey: 'admin.nav.telegramDescription',
    to: '/admin/telegram',
    icon: Send
  },
  {
    id: 'site',
    labelKey: 'admin.nav.site',
    descriptionKey: 'admin.nav.siteDescription',
    to: '/admin/site',
    icon: Settings,
    children: [
      { id: 'site-appearance', labelKey: 'admin.nav.siteAppearance', hash: '#site-appearance' },
      { id: 'version-update', labelKey: 'admin.nav.versionUpdate', hash: '#version-update' }
    ]
  },
  {
    id: 'maintenance',
    labelKey: 'admin.nav.maintenance',
    descriptionKey: 'admin.nav.maintenanceDescription',
    to: '/admin/maintenance',
    icon: Wrench,
    separated: true
  }
];

export const adminRouteIcons = {
  dashboard: Gauge,
  users: UserCog,
  storage: Database,
  invites: UserPlus,
  telegram: Send,
  site: Settings,
  maintenance: Wrench
};
