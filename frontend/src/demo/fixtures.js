const FIXTURE_TIME = '2026-08-14T10:00:00.000Z';

function createDemoVoiceDataUrl() {
  const sampleRate = 8000;
  const durationSeconds = 3.2;
  const sampleCount = Math.round(sampleRate * durationSeconds);
  const bytes = new Uint8Array(44 + sampleCount);
  const view = new DataView(bytes.buffer);
  const writeText = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      bytes[offset + index] = value.charCodeAt(index);
    }
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + sampleCount, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeText(36, 'data');
  view.setUint32(40, sampleCount, true);

  // 生成轻柔且有起伏的短音频，便于在 demo 中真实验证播放、暂停与进度交互。
  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    const envelope = Math.sin(Math.PI * Math.min(time / 0.12, 1, (durationSeconds - time) / 0.18));
    const modulation = Math.sin(2 * Math.PI * 2.4 * time) * 18;
    const sample = Math.sin(2 * Math.PI * (176 + modulation) * time);
    bytes[44 + index] = 128 + Math.round(sample * envelope * 24);
  }

  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

const DEMO_VOICE_URL = createDemoVoiceDataUrl();

function internalSender(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    kind: 'user',
    source: 'edgechat'
  };
}

export function createDemoFixtures() {
  const users = [
    {
      id: 1,
      username: 'admin',
      displayName: '演示管理员',
      bio: '',
      avatarUrl: '',
      isAdmin: true,
      isDisabled: false,
      isPermanentlyDisabled: false,
      disabledUntil: null,
      createdAt: '2026-05-18T08:00:00.000Z'
    },
    {
      id: 2,
      username: 'alice',
      displayName: 'Alice',
      avatarUrl: '',
      isAdmin: false,
      isDisabled: false,
      isPermanentlyDisabled: false,
      disabledUntil: null,
      createdAt: '2026-06-02T09:30:00.000Z'
    },
    {
      id: 3,
      username: 'bob',
      displayName: 'Bob',
      avatarUrl: '',
      isAdmin: false,
      isDisabled: false,
      isPermanentlyDisabled: false,
      disabledUntil: null,
      createdAt: '2026-06-12T03:20:00.000Z'
    },
    {
      id: 4,
      username: 'carol',
      displayName: 'Carol',
      avatarUrl: '',
      isAdmin: false,
      isDisabled: false,
      isPermanentlyDisabled: false,
      disabledUntil: null,
      createdAt: '2026-07-01T13:10:00.000Z'
    },
    {
      id: 5,
      username: 'dave',
      displayName: 'Dave',
      avatarUrl: '',
      isAdmin: false,
      isDisabled: true,
      isPermanentlyDisabled: true,
      disabledUntil: null,
      createdAt: '2026-07-20T05:45:00.000Z'
    },
    {
      id: 6,
      username: 'alicia',
      displayName: 'Alice',
      bio: '',
      avatarUrl: '',
      isAdmin: false,
      isDisabled: false,
      isPermanentlyDisabled: false,
      disabledUntil: null,
      createdAt: '2026-08-02T11:20:00.000Z'
    },
    {
      id: 7,
      username: 'long-name',
      displayName: '负责跨团队协作与超长姓名布局验证的演示用户',
      bio: '用于验证长名称在通讯录与资料卡中的自然降级。',
      avatarUrl: '',
      isAdmin: false,
      isDisabled: false,
      isPermanentlyDisabled: false,
      disabledUntil: null,
      createdAt: '2026-08-03T12:30:00.000Z'
    }
  ];

  const channels = [
    {
      id: 1,
      kind: 'public',
      name: 'General',
      description: '全员公告与日常交流',
      avatarKey: '',
      avatarUrl: '',
      isGeneral: true,
      ownerId: 1,
      ownerDisplayName: '演示管理员',
      isMember: true,
      myRole: 'owner',
      canManage: true,
      memberCount: 4,
      memberIds: [1, 2, 3, 4],
      lastMessageAt: '2026-08-14T09:58:00.000Z',
      unreadCount: 0,
      createdAt: '2026-05-18T08:00:00.000Z'
    },
    {
      id: 2,
      kind: 'private',
      name: '产品协作',
      description: '规划版本与验证交付',
      avatarKey: '',
      avatarUrl: '',
      isGeneral: false,
      ownerId: 1,
      ownerDisplayName: '演示管理员',
      isMember: true,
      myRole: 'owner',
      canManage: true,
      memberCount: 3,
      memberIds: [1, 2, 3],
      lastMessageAt: '2026-08-14T09:35:00.000Z',
      unreadCount: 2,
      mentionUnreadCount: 1,
      createdAt: '2026-07-10T10:00:00.000Z'
    },
    {
      id: 3,
      kind: 'public',
      name: 'Telegram 联动',
      description: '展示 EdgeChat 与 Telegram 群消息双向同步',
      avatarKey: '',
      avatarUrl: '',
      isGeneral: false,
      ownerId: 1,
      ownerDisplayName: '演示管理员',
      isMember: true,
      myRole: 'owner',
      canManage: true,
      memberCount: 4,
      memberIds: [1, 2, 3, 4],
	      lastMessageAt: '2026-08-14T09:50:00.000Z',
	      unreadCount: 1,
	      mentionUnreadCount: 1,
      createdAt: '2026-07-18T12:00:00.000Z'
    },
    {
      id: 4,
      kind: 'public',
      name: '公开讨论',
      description: '任何成员都可以发现并加入',
      avatarKey: '',
      avatarUrl: '',
      isGeneral: false,
      ownerId: 4,
      ownerDisplayName: 'Carol',
      isMember: false,
      myRole: '',
      canManage: false,
      memberCount: 2,
      memberIds: [3, 4],
      lastMessageAt: '2026-08-13T14:20:00.000Z',
      unreadCount: 0,
      createdAt: '2026-08-01T08:00:00.000Z'
    }
  ];

  const dms = [
    {
      id: 10,
      kind: 'dm',
      otherUser: users[1],
      participantIds: [1, 2],
      lastMessageAt: '2026-08-14T09:42:00.000Z',
      unreadCount: 0,
      createdAt: '2026-08-05T06:00:00.000Z'
    }
  ];

  const messages = {
    'public:1': [
      {
        id: 101,
        content: '欢迎来到 EdgeChat 演示站。这里展示频道、私信、附件与消息管理。',
        createdAt: '2026-08-14T09:20:00.000Z',
        sender: internalSender(users[1]),
        attachment: null
      },
      {
        id: 102,
        content: '管理员可以从左侧进入后台，查看用户、邀请、站点设置和 Telegram 映射。',
        createdAt: '2026-08-14T09:28:00.000Z',
        sender: internalSender(users[0]),
        attachment: null
      },
      {
        id: 103,
        content: '这是一条图片附件消息，点击图片可以打开预览。',
        createdAt: '2026-08-14T09:36:00.000Z',
        sender: internalSender(users[2]),
        attachment: {
          key: '/logo.svg',
          url: '/logo.svg',
          name: 'edgechat-logo.svg',
          type: 'image/svg+xml',
          size: 8420
        }
      },
		{
			id: 104,
			content: '所有演示操作都只保存在当前浏览器页面中。',
			createdAt: '2026-08-14T09:58:00.000Z',
			sender: internalSender(users[3]),
			attachment: null
		},
		{
			id: 105,
			content: '',
			createdAt: '2026-08-14T10:01:00.000Z',
			sender: internalSender(users[1]),
				attachment: {
					key: DEMO_VOICE_URL,
					url: DEMO_VOICE_URL,
					name: 'voice-demo.wav',
					type: 'audio/wav',
					size: 25644,
					kind: 'voice',
					durationMs: 3200,
				waveform: [18, 30, 46, 72, 88, 64, 42, 28, 36, 58, 82, 94, 76, 54, 34, 22, 40, 68, 90, 74, 50, 32, 48, 78]
			}
		}
	],
    'private:2': [
      {
        id: 111,
        content: '新版本的附件授权读取已经验证完成。',
        createdAt: '2026-08-14T09:12:00.000Z',
        sender: internalSender(users[1]),
        attachment: null
      },
      {
        id: 112,
        content: '@admin 收到，我会继续检查移动端消息列表。',
        createdAt: '2026-08-14T09:35:00.000Z',
        sender: internalSender(users[2]),
        mentionUserIds: [1],
        mentions: [{ userId: 1, username: 'admin', displayName: '演示管理员' }],
        attachment: null
      }
    ],
    'public:3': [
      {
        id: 121,
        content: '这条消息由 EdgeChat 发送，并同步到了 Telegram 群。',
        createdAt: '2026-08-14T09:44:00.000Z',
        sender: internalSender(users[0]),
        attachment: null
      },
      {
        id: 122,
        content: 'Telegram 群里的回复也会回到同一个 EdgeChat 频道。',
        createdAt: '2026-08-14T09:50:00.000Z',
	        sender: {
          id: 'telegram:-1002345678901:alice',
          username: '',
          displayName: 'Telegram · Alice',
          avatarUrl: '',
          kind: 'external',
	          source: 'telegram'
	        },
	        replyToMessageId: 121,
	        replyTo: {
	          id: 121,
	          deleted: false,
	          content: '这条消息由 EdgeChat 发送，并同步到了 Telegram 群。',
	          sender: internalSender(users[0]),
	          attachment: null
	        },
	        attachment: null
      }
    ],
    'public:4': [
      {
        id: 131,
        content: '这个公开群组尚未加入，点击后会在本地模拟加入。',
        createdAt: '2026-08-13T14:20:00.000Z',
        sender: internalSender(users[3]),
        attachment: null
      }
    ],
    'dm:10': [
      {
        id: 141,
        content: '你好，这里是一对一私信会话。',
        createdAt: '2026-08-14T09:30:00.000Z',
        sender: internalSender(users[1]),
        attachment: null
      },
      {
        id: 142,
        content: '消息发送、附件上传和删除都可以在 demo 中体验。',
        createdAt: '2026-08-14T09:42:00.000Z',
        sender: internalSender(users[0]),
        attachment: null
      }
    ]
  };

  return {
    site: { siteName: 'EdgeChat Demo', siteIconUrl: '/logo.svg' },
    session: {
      token: 'edgechat-demo-session',
      userId: 1,
      username: 'admin',
      displayName: '演示管理员',
      avatarUrl: '',
      isAdmin: true,
      sessionVersion: 1
    },
    users,
    channels,
    dms,
		messages,
		userBlocks: new Set(),
    pinnedMessages: {
      'public:1': messages['public:1'][1]
    },
    files: new Map(),
    invites: [
      {
        id: 1,
        token: 'demo-invite',
        note: '体验邀请注册流程',
        maxUses: 10,
        usedCount: 2,
        remainingUses: 8,
        isAvailable: true,
        deletedAt: null,
        consumerDisplayName: 'Carol',
        creatorDisplayName: '演示管理员',
        createdAt: '2026-08-12T03:00:00.000Z'
      },
      {
        id: 2,
        token: 'team-preview',
        note: '产品体验成员',
        maxUses: 3,
        usedCount: 3,
        remainingUses: 0,
        isAvailable: false,
        deletedAt: null,
        consumerDisplayName: 'Bob',
        creatorDisplayName: '演示管理员',
        createdAt: '2026-08-08T06:00:00.000Z'
      }
    ],
    telegram: {
      config: {
        configured: true,
        botUsername: 'edgechat_demo_bot',
        webhookUrl: 'https://edgechat-demo.workers.dev/api/telegram/webhook'
      },
      mappings: [
        {
          id: 1,
          channelId: 3,
          channelName: 'Telegram 联动',
          telegramChatTitle: 'EdgeChat 演示群',
          telegramChatId: '-1002345678901',
          enabled: true
        }
      ]
    },
    nextUserId: 8,
    nextChannelId: 5,
    nextDmId: 11,
    nextMessageId: 150,
    nextInviteId: 3,
    nextMappingId: 2,
    fixtureTime: FIXTURE_TIME
  };
}
