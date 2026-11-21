import './touch-keyboard.css';
import { preferences } from '../../../wow/hal/storage';

type KeyboardLayoutPref = 'auto' | 'desktop' | 'mobile';
type KeyboardThemePref = 'dark' | 'light';
type MobilePage = 'abc' | 'num' | 'sym';
type ActivePanel = 'none' | 'settings' | 'emoji' | 'clipboard';

interface TouchKeyboardPrefs {
  layout: KeyboardLayoutPref;
  theme: KeyboardThemePref;
  sound: boolean;
  haptics: boolean;
}

interface KeySpec {
  id: string;
  label?: string;
  sub?: string;
  fnLabel?: string;
  hint?: string;
  flex?: number;
  kind?: 'char' | 'fn';
  align?: 'left' | 'right' | 'center';
  icon?: 'backspace' | 'win' | 'mic' | 'up' | 'left' | 'down' | 'right' | 'shift' | 'emoji' | 'enter';
}

const PREFS_KEY = 'shell:touch-keyboard:v1';

// 轻量常用中文拼音候选词表（支持简体模式下直接拼词上屏）
const PINYIN_DICT: Record<string, string[]> = {
  a: ['啊', '阿', '爱'],
  ai: ['爱', '矮', '艾'],
  an: ['安', '按', '案'],
  ba: ['把', '吧', '八', '爸'],
  bai: ['白', '百', '拜'],
  ban: ['办', '版', '半'],
  bao: ['包', '保', '报'],
  bei: ['北', '被', '备'],
  ben: ['本', '奔'],
  bi: ['比', '必', '笔'],
  bian: ['变', '便', '编'],
  biao: ['表', '标'],
  bie: ['别', '憋'],
  bu: ['不', '部', '步', '补'],
  cai: ['才', '菜', '猜'],
  can: ['参', '餐'],
  cao: ['草', '操'],
  ce: ['测', '策', '侧'],
  ceshi: ['测试'],
  cha: ['查', '差', '茶'],
  chang: ['常', '长', '场'],
  chao: ['超', '朝'],
  che: ['车', '撤'],
  chen: ['陈', '沉'],
  cheng: ['成', '程', '城'],
  chi: ['吃', '持', '池'],
  chong: ['重', '充', '冲'],
  chu: ['出', '初', '处'],
  chuan: ['传', '穿', '船'],
  chuang: ['窗', '创', '床'],
  ci: ['次', '此', '词'],
  cong: ['从', '聪'],
  cuo: ['错', '措'],
  da: ['大', '打', '达', '答'],
  dai: ['代', '带', '待'],
  dan: ['但', '单', '蛋'],
  dang: ['当', '党', '档'],
  dao: ['到', '道', '导', '倒'],
  de: ['的', '得', '德'],
  deng: ['等', '登', '灯'],
  di: ['地', '第', '底', '低'],
  dian: ['点', '电', '店'],
  diannao: ['电脑'],
  diao: ['调', '掉'],
  ding: ['定', '顶', '订'],
  dong: ['动', '东', '懂'],
  dou: ['都', '豆', '斗'],
  du: ['读', '度', '独'],
  duan: ['段', '短', '端'],
  dui: ['对', '队', '堆'],
  duo: ['多', '朵', '躲'],
  er: ['而', '二', '儿'],
  fa: ['发', '法', '罚'],
  fan: ['反', '翻', '饭'],
  fang: ['方', '放', '防', '房'],
  fei: ['非', '飞', '费'],
  fen: ['分', '份', '粉'],
  feng: ['风', '封', '丰'],
  fu: ['服', '复', '付', '副'],
  gai: ['改', '该', '概'],
  gan: ['感', '干', '敢'],
  gang: ['刚', '港', '钢'],
  gao: ['高', '告', '搞'],
  ge: ['个', '各', '哥', '歌'],
  gei: ['给'],
  gen: ['跟', '根'],
  geng: ['更', '耕'],
  gong: ['工', '公', '共', '功'],
  gou: ['够', '构', '购'],
  gu: ['古', '固', '故', '顾'],
  gua: ['挂', '瓜'],
  guan: ['关', '管', '观'],
  guanli: ['管理'],
  guanliyuan: ['管理员'],
  guang: ['光', '广'],
  gui: ['规', '贵', '归'],
  guo: ['国', '过', '果'],
  hai: ['还', '海', '害'],
  han: ['汉', '含', '寒'],
  hang: ['行', '航'],
  hao: ['好', '号', '毫'],
  he: ['和', '合', '何', '河'],
  hei: ['黑'],
  hen: ['很', '恨'],
  heng: ['横', '恒'],
  hong: ['红', '宏'],
  hou: ['后', '候', '厚'],
  hu: ['户', '互', '护', '呼'],
  hua: ['化', '话', '画', '花'],
  huai: ['坏', '怀'],
  huan: ['换', '环', '欢', '还'],
  huang: ['黄', '皇'],
  hui: ['会', '回', '汇', '灰'],
  huo: ['或', '活', '火', '货'],
  ji: ['机', '及', '级', '记', '几', '集'],
  jia: ['加', '家', '价', '假'],
  jian: ['件', '见', '建', '间', '简', '键'],
  jianpan: ['键盘'],
  jiang: ['将', '讲', '降'],
  jiao: ['教', '交', '叫', '角'],
  jie: ['接', '结', '解', '界', '节'],
  jin: ['进', '今', '近', '金', '仅'],
  jing: ['经', '精', '景', '静'],
  jiu: ['就', '九', '旧', '久'],
  ju: ['具', '局', '句', '据'],
  jue: ['决', '觉', '绝'],
  jun: ['均', '军'],
  kai: ['开', '凯'],
  kaifa: ['开发'],
  kan: ['看', '刊'],
  kao: ['考', '靠'],
  ke: ['可', '客', '科', '课', '刻'],
  kong: ['空', '控'],
  kou: ['口', '扣'],
  ku: ['库', '苦', '酷'],
  kuai: ['快', '块'],
  kuan: ['宽', '款'],
  kuang: ['框', '况'],
  la: ['拉', '啦'],
  lai: ['来', '赖'],
  lan: ['蓝', '栏', '览'],
  lao: ['老', '劳'],
  le: ['了', '乐'],
  lei: ['类', '累', '雷'],
  leng: ['冷'],
  li: ['里', '理', '力', '立', '例', '离'],
  lian: ['连', '联', '练', '脸'],
  liang: ['两', '量', '亮'],
  liao: ['聊', '料', '了'],
  lie: ['列', '裂'],
  lin: ['临', '林', '邻'],
  ling: ['另', '零', '令', '灵'],
  liu: ['流', '留', '六', '浏'],
  long: ['龙', '隆'],
  lou: ['楼', '漏'],
  lu: ['路', '录', '陆', '绿'],
  luan: ['乱'],
  lun: ['论', '轮'],
  luo: ['落', '逻', '罗'],
  ma: ['吗', '码', '马', '妈'],
  mai: ['买', '卖', '麦'],
  man: ['满', '慢', '漫'],
  mang: ['忙', '盲'],
  mao: ['猫', '毛', '冒'],
  me: ['么'],
  mei: ['没', '每', '美', '媒'],
  men: ['们', '门'],
  mi: ['密', '米', '迷'],
  mima: ['密码'],
  mian: ['面', '免', '眠'],
  miao: ['秒', '描', '妙'],
  min: ['民', '敏'],
  ming: ['名', '明', '命'],
  mo: ['模', '默', '末', '魔'],
  mou: ['某'],
  mu: ['目', '木', '母'],
  na: ['那', '哪', '拿'],
  nai: ['耐', '奶'],
  nan: ['难', '南', '男'],
  nao: ['脑', '闹'],
  ne: ['呢'],
  nei: ['内'],
  neng: ['能'],
  ni: ['你', '拟', '逆'],
  nihao: ['你好'],
  nian: ['年', '念'],
  nin: ['您'],
  niu: ['牛', '扭'],
  nong: ['农', '弄'],
  nu: ['努', '怒'],
  nv: ['女'],
  nuan: ['暖'],
  ou: ['欧', '偶'],
  pa: ['怕', '爬'],
  pai: ['排', '拍', '派'],
  pan: ['盘', '判', '盼'],
  pang: ['旁', '胖'],
  pao: ['跑', '泡'],
  pei: ['配', '陪'],
  peng: ['朋', '碰'],
  pi: ['批', '皮', '匹'],
  pian: ['片', '篇', '偏'],
  piao: ['票', '漂'],
  pin: ['品', '拼', '频'],
  ping: ['屏', '平', '评'],
  pingmu: ['屏幕'],
  po: ['破', '迫'],
  pu: ['普', '铺'],
  qi: ['起', '其', '器', '期', '七', '启'],
  qian: ['前', '千', '签', '钱'],
  qiang: ['强', '墙', '抢'],
  qiao: ['巧', '桥', '敲'],
  qie: ['切', '且'],
  qin: ['亲', '勤'],
  qing: ['请', '清', '轻', '情'],
  qiu: ['求', '球', '秋'],
  qu: ['去', '区', '取', '趣'],
  quan: ['全', '权', '圈'],
  que: ['确', '缺', '却'],
  qun: ['群'],
  ran: ['然', '燃'],
  rang: ['让'],
  re: ['热'],
  ren: ['人', '任', '认'],
  reng: ['仍', '扔'],
  ri: ['日'],
  rong: ['容', '融'],
  rou: ['肉', '柔'],
  ru: ['如', '入', '乳'],
  ruan: ['软'],
  rui: ['锐', '瑞'],
  run: ['润'],
  ruo: ['若', '弱'],
  sa: ['撒'],
  sai: ['赛'],
  san: ['三', '散'],
  sao: ['扫'],
  se: ['色'],
  sen: ['森'],
  sha: ['杀', '沙', '啥'],
  shan: ['删', '山', '闪', '善'],
  shang: ['上', '商', '伤'],
  shao: ['少', '烧', '稍'],
  she: ['设', '社', '射', '舍'],
  shezhi: ['设置'],
  shen: ['什', '深', '身', '申', '神'],
  sheng: ['生', '声', '升', '省'],
  shi: ['是', '时', '使', '事', '实', '十', '式', '试'],
  shou: ['手', '收', '首', '受', '守'],
  shu: ['数', '书', '输', '属', '树'],
  shua: ['刷'],
  shuai: ['帅', '率'],
  shuang: ['双', '爽'],
  shui: ['谁', '水', '睡'],
  shun: ['顺', '瞬'],
  shuo: ['说'],
  si: ['四', '思', '私', '司', '死'],
  song: ['送', '松'],
  sou: ['搜'],
  su: ['速', '素', '诉', '苏'],
  suan: ['算', '酸'],
  sui: ['随', '岁', '虽'],
  sun: ['损', '孙'],
  suo: ['所', '锁', '缩'],
  ta: ['他', '她', '它', '塔'],
  tai: ['台', '太', '态'],
  tan: ['谈', '弹', '探'],
  tang: ['堂', '躺', '糖'],
  tao: ['套', '讨', '逃'],
  te: ['特'],
  teng: ['疼', '腾'],
  ti: ['提', '体', '题', '替'],
  tian: ['天', '添', '填', '田'],
  tiao: ['条', '跳', '调'],
  tie: ['贴', '铁'],
  ting: ['停', '听', '厅'],
  tong: ['同', '通', '统', '痛'],
  tou: ['头', '投', '透'],
  tu: ['图', '突', '土', '途'],
  tuan: ['团'],
  tui: ['推', '退'],
  tun: ['吞'],
  tuo: ['拖', '脱', '托'],
  wa: ['挖', '瓦', '哇'],
  wai: ['外'],
  wan: ['完', '万', '玩', '晚', '网'],
  wang: ['网', '望', '忘', '王', '往'],
  wei: ['为', '位', '微', '未', '维', '伟'],
  wen: ['文', '问', '稳', '温'],
  wenjian: ['文件'],
  wo: ['我', '握', '卧'],
  women: ['我们'],
  wu: ['无', '五', '物', '务', '误'],
  xi: ['系', '西', '喜', '细', '息', '洗'],
  xitong: ['系统'],
  xia: ['下', '夏', '吓'],
  xian: ['现', '先', '显', '线', '限', '鲜'],
  xiang: ['想', '向', '项', '像', '响', '详'],
  xiao: ['小', '消', '笑', '效', '校'],
  xie: ['写', '些', '谢', '协'],
  xin: ['新', '信', '心', '辛'],
  xing: ['行', '性', '星', '型', '兴'],
  xiong: ['兄', '熊'],
  xiu: ['修', '休', '秀'],
  xu: ['需', '续', '许', '序', '虚'],
  xuan: ['选', '宣', '旋'],
  xue: ['学', '雪', '血'],
  xun: ['寻', '询', '训', '迅'],
  ya: ['压', '亚', '呀'],
  yan: ['验', '严', '研', '眼', '言', '颜'],
  yang: ['样', '阳', '养', '央'],
  yao: ['要', '邀', '摇', '药'],
  ye: ['也', '页', '业', '夜'],
  yi: ['一', '以', '已', '意', '移', '易', '义', '亿'],
  yin: ['因', '音', '引', '隐', '印'],
  ying: ['应', '影', '硬', '营', '英'],
  yingyong: ['应用'],
  yong: ['用', '永', '拥'],
  yonghu: ['用户'],
  you: ['有', '又', '右', '游', '由', '优', '邮'],
  yu: ['与', '于', '语', '预', '域', '遇', '雨'],
  yuan: ['原', '元', '源', '员', '远', '院'],
  yue: ['月', '越', '约', '阅'],
  yun: ['运', '云', '允'],
  za: ['杂', '砸'],
  zai: ['在', '再', '载'],
  zan: ['赞', '暂', '咱'],
  zao: ['早', '造', '遭'],
  ze: ['则', '责', '择'],
  zen: ['怎'],
  zeng: ['增', '曾'],
  zha: ['查', '炸', '扎'],
  zhai: ['摘', '窄'],
  zhan: ['展', '站', '占', '战'],
  zhang: ['张', '长', '章', '账', '帐'],
  zhao: ['找', '照', '招', '召'],
  zhe: ['这', '者', '折', '着'],
  zhen: ['真', '针', '阵', '镇'],
  zheng: ['正', '整', '证', '政', '争'],
  zhi: ['之', '只', '知', '直', '指', '支', '置', '值', '制'],
  zhong: ['中', '重', '种', '终', '钟'],
  zhongguo: ['中国'],
  zhou: ['周', '州', '轴'],
  zhu: ['主', '注', '住', '助', '组'],
  zhua: ['抓'],
  zhuan: ['转', '专', '传'],
  zhuang: ['装', '状', '撞'],
  zhui: ['追'],
  zhun: ['准'],
  zhuo: ['桌', '抓'],
  zhuomian: ['桌面'],
  zi: ['自', '字', '资', '子'],
  zong: ['总', '宗', '纵'],
  zou: ['走'],
  zu: ['组', '足', '租', '阻'],
  zui: ['最', '嘴', '罪'],
  zun: ['尊'],
  zuo: ['做', '作', '左', '坐', '座'],
};

const EMOJI_CATEGORIES: Array<{ id: string; label: string; items: string[] }> = [
  {
    id: 'common',
    label: '常用',
    items: ['😀', '😂', '🥹', '😍', '🤔', '😎', '🥳', '😭', '👍', '👏', '🙏', '🔥', '✨', '❤️', '💯', '🎉', '🚀', '⚡', '✅', '❌'],
  },
  {
    id: 'work',
    label: '办公',
    items: ['💻', '🖥️', '⌨️', '🖱️', '📱', '📁', '📄', '📝', '📌', '🔒', '🔑', '⚙️', '🔍', '📊', '🌐', '📧', '📅', '⏰', '🔔', '🛠️'],
  },
  {
    id: 'symbols',
    label: '符号',
    items: ['—', '…', '·', '©', '®', '™', '°', '±', '×', '÷', '≈', '≠', '≤', '≥', '←', '→', '↑', '↓', '★', '☆'],
  },
];

// 桌面完整 5 行 Fluent 布局（1:1 复刻 Windows 11 现代触控键盘，每行总权重 15.6）
const DESKTOP_ROWS: KeySpec[][] = [
  [
    { id: 'Esc', label: 'Esc', flex: 1.0, kind: 'fn' },
    { id: '`', sub: '~', label: '`', flex: 1 },
    { id: '1', sub: '!', label: '1', fnLabel: 'F1', flex: 1 },
    { id: '2', sub: '@', label: '2', fnLabel: 'F2', flex: 1 },
    { id: '3', sub: '#', label: '3', fnLabel: 'F3', flex: 1 },
    { id: '4', sub: '$', label: '4', fnLabel: 'F4', flex: 1 },
    { id: '5', sub: '%', label: '5', fnLabel: 'F5', flex: 1 },
    { id: '6', sub: '^', label: '6', fnLabel: 'F6', flex: 1 },
    { id: '7', sub: '&', label: '7', fnLabel: 'F7', flex: 1 },
    { id: '8', sub: '*', label: '8', fnLabel: 'F8', flex: 1 },
    { id: '9', sub: '(', label: '9', fnLabel: 'F9', flex: 1 },
    { id: '0', sub: ')', label: '0', fnLabel: 'F10', flex: 1 },
    { id: '-', sub: '_', label: '-', fnLabel: 'F11', flex: 1 },
    { id: '=', sub: '+', label: '=', fnLabel: 'F12', flex: 1 },
    { id: 'Backspace', icon: 'backspace', flex: 1.6, kind: 'fn', align: 'right' },
  ],
  [
    { id: 'Tab', label: 'Tab', flex: 1.5, kind: 'fn', align: 'left' },
    { id: 'q', label: 'q', flex: 1 },
    { id: 'w', label: 'w', flex: 1 },
    { id: 'e', label: 'e', flex: 1 },
    { id: 'r', label: 'r', flex: 1 },
    { id: 't', label: 't', flex: 1 },
    { id: 'y', label: 'y', flex: 1 },
    { id: 'u', label: 'u', flex: 1 },
    { id: 'i', label: 'i', flex: 1 },
    { id: 'o', label: 'o', flex: 1 },
    { id: 'p', label: 'p', flex: 1 },
    { id: '[', sub: '{', label: '[', flex: 1 },
    { id: ']', sub: '}', label: ']', flex: 1 },
    { id: '\\', sub: '|', label: '\\', flex: 1 },
    { id: 'Del', label: 'Del', flex: 1.1, kind: 'fn' },
  ],
  [
    { id: 'Caps', label: 'Caps', flex: 1.9, kind: 'fn', align: 'left' },
    { id: 'a', label: 'a', flex: 1 },
    { id: 's', label: 's', flex: 1 },
    { id: 'd', label: 'd', flex: 1 },
    { id: 'f', label: 'f', flex: 1 },
    { id: 'g', label: 'g', flex: 1 },
    { id: 'h', label: 'h', flex: 1 },
    { id: 'j', label: 'j', flex: 1 },
    { id: 'k', label: 'k', flex: 1 },
    { id: 'l', label: 'l', flex: 1 },
    { id: ';', sub: ':', label: ';', flex: 1 },
    { id: "'", sub: '"', label: "'", flex: 1 },
    { id: 'Enter', label: '回车', flex: 2.7, kind: 'fn', align: 'right' },
  ],
  [
    { id: 'ShiftL', label: 'Shift', flex: 2.4, kind: 'fn', align: 'left' },
    { id: 'z', label: 'z', flex: 1 },
    { id: 'x', label: 'x', flex: 1 },
    { id: 'c', label: 'c', flex: 1 },
    { id: 'v', label: 'v', flex: 1 },
    { id: 'b', label: 'b', flex: 1 },
    { id: 'n', label: 'n', flex: 1 },
    { id: 'm', label: 'm', flex: 1 },
    { id: ',', sub: '<', label: ',', flex: 1 },
    { id: '.', sub: '>', label: '.', flex: 1 },
    { id: '/', sub: '?', label: '/', flex: 1 },
    { id: 'ArrowUp', icon: 'up', flex: 1, kind: 'fn' },
    { id: 'ShiftR', label: 'Shift', flex: 2.2, kind: 'fn', align: 'right' },
  ],
  [
    { id: 'CtrlL', label: 'Ctrl', flex: 1.1, kind: 'fn' },
    { id: 'Fn', label: 'Fn', flex: 1.0, kind: 'fn' },
    { id: 'Win', icon: 'win', flex: 1.0, kind: 'fn' },
    { id: 'AltL', label: 'Alt', flex: 1.0, kind: 'fn' },
    { id: 'Voice', icon: 'mic', flex: 1.0, kind: 'fn' },
    { id: 'Space', label: '', flex: 4.3 },
    { id: 'AltR', label: 'Alt', flex: 1.0, kind: 'fn' },
    { id: 'CtrlR', label: 'Ctrl', flex: 1.0, kind: 'fn' },
    { id: 'ArrowLeft', icon: 'left', flex: 1.0, kind: 'fn' },
    { id: 'ArrowDown', icon: 'down', flex: 1.0, kind: 'fn' },
    { id: 'ArrowRight', icon: 'right', flex: 1.0, kind: 'fn' },
    { id: 'Ime', label: '简体', flex: 1.2, kind: 'fn' },
  ],
];

const MOBILE_ABC_ROWS: KeySpec[][] = [
  [
    { id: 'q', label: 'q', hint: '1' },
    { id: 'w', label: 'w', hint: '2' },
    { id: 'e', label: 'e', hint: '3' },
    { id: 'r', label: 'r', hint: '4' },
    { id: 't', label: 't', hint: '5' },
    { id: 'y', label: 'y', hint: '6' },
    { id: 'u', label: 'u', hint: '7' },
    { id: 'i', label: 'i', hint: '8' },
    { id: 'o', label: 'o', hint: '9' },
    { id: 'p', label: 'p', hint: '0' },
  ],
  [
    { id: 'a', label: 'a' },
    { id: 's', label: 's' },
    { id: 'd', label: 'd' },
    { id: 'f', label: 'f' },
    { id: 'g', label: 'g' },
    { id: 'h', label: 'h' },
    { id: 'j', label: 'j' },
    { id: 'k', label: 'k' },
    { id: 'l', label: 'l' },
  ],
  [
    { id: 'ShiftL', icon: 'shift', flex: 1.45, kind: 'fn' },
    { id: 'z', label: 'z' },
    { id: 'x', label: 'x' },
    { id: 'c', label: 'c' },
    { id: 'v', label: 'v' },
    { id: 'b', label: 'b' },
    { id: 'n', label: 'n' },
    { id: 'm', label: 'm' },
    { id: 'Backspace', icon: 'backspace', flex: 1.45, kind: 'fn' },
  ],
  [
    { id: 'PageNum', label: '&123', flex: 1.5, kind: 'fn' },
    { id: 'Ime', label: '简体', flex: 1.25, kind: 'fn' },
    { id: 'Emoji', icon: 'emoji', flex: 1.1, kind: 'fn' },
    { id: 'Space', label: '空格', flex: 3.4 },
    { id: 'Voice', icon: 'mic', flex: 1.1, kind: 'fn' },
    { id: 'Enter', label: '回车', flex: 1.65, kind: 'fn' },
  ],
];

const MOBILE_NUM_ROWS: KeySpec[][] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((k) => ({ id: k, label: k })),
  ['@', '#', '$', '%', '&', '-', '+', '(', ')', '/'].map((k) => ({ id: k, label: k })),
  [
    { id: 'PageSym', label: '=\\<', flex: 1.5, kind: 'fn' },
    ...['*', '"', "'", ':', ';', '!', '?', '_'].map((k) => ({ id: k, label: k })),
    { id: 'Backspace', icon: 'backspace', flex: 1.5, kind: 'fn' },
  ],
  [
    { id: 'PageAbc', label: 'ABC', flex: 1.6, kind: 'fn' },
    { id: ',', label: ',', flex: 1, kind: 'fn' },
    { id: 'Space', label: '空格', flex: 4.0 },
    { id: '.', label: '.', flex: 1, kind: 'fn' },
    { id: 'Enter', label: '回车', flex: 1.8, kind: 'fn' },
  ],
];

const MOBILE_SYM_ROWS: KeySpec[][] = [
  ['~', '`', '|', '^', '¥', '€', '[', ']', '{', '}'].map((k) => ({ id: k, label: k })),
  ['<', '>', '=', '\\', '·', '—', '（', '）', '、', '。'].map((k) => ({ id: k, label: k })),
  [
    { id: 'PageNum', label: '&123', flex: 1.5, kind: 'fn' },
    { id: 'ArrowLeft', icon: 'left', flex: 1, kind: 'fn' },
    { id: 'ArrowRight', icon: 'right', flex: 1, kind: 'fn' },
    ...['，', '！', '？', '：', '“', '”'].map((k) => ({ id: k, label: k })),
    { id: 'Backspace', icon: 'backspace', flex: 1.5, kind: 'fn' },
  ],
  [
    { id: 'PageAbc', label: 'ABC', flex: 1.6, kind: 'fn' },
    { id: 'Del', label: 'Del', flex: 1.2, kind: 'fn' },
    { id: 'Space', label: '空格', flex: 3.8 },
    { id: 'Emoji', icon: 'emoji', flex: 1.1, kind: 'fn' },
    { id: 'Enter', label: '回车', flex: 1.8, kind: 'fn' },
  ],
];

const ICONS = {
  settings:
    '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25"><circle cx="8" cy="8" r="2.4"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1" stroke-linecap="round"/></svg>',
  emoji:
    '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25"><circle cx="8" cy="8" r="6"/><circle cx="6" cy="6.6" r="0.8" fill="currentColor" stroke="none"/><circle cx="10" cy="6.6" r="0.8" fill="currentColor" stroke="none"/><path d="M5.4 9.7a3.2 3.2 0 0 0 5.2 0" stroke-linecap="round"/></svg>',
  clipboard:
    '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25"><rect x="3.2" y="3" width="9.6" height="11" rx="1.4"/><path d="M5.8 3V2h4.4v1M5.6 7h4.8M5.6 9.8h3.6" stroke-linecap="round"/></svg>',
  dock: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25"><path d="M3 13h10M8 3v7.2M5.4 7.8L8 10.4l2.6-2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  float: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25"><rect x="2.5" y="3.5" width="11" height="8" rx="1.4"/><path d="M5 13.5h6" stroke-linecap="round"/></svg>',
  close: '<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"><path d="M3 3l8 8M11 3l-8 8"/></svg>',
  backspace:
    '<svg width="18" height="13" viewBox="0 0 20 14" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"><path d="M6.4 1.8h11.6a1 1 0 0 1 1 1v8.4a1 1 0 0 1-1 1H6.4L1.6 7l4.8-5.2z"/><path d="M9.6 4.6l4.8 4.8M14.4 4.6l-4.8 4.8" stroke-linecap="round"/></svg>',
  win: '<svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="1" width="5.6" height="5.6" rx="0.6"/><rect x="7.4" y="1" width="5.6" height="5.6" rx="0.6"/><rect x="1" y="7.4" width="5.6" height="5.6" rx="0.6"/><rect x="7.4" y="7.4" width="5.6" height="5.6" rx="0.6"/></svg>',
  mic: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><rect x="5.8" y="2" width="4.4" height="7.4" rx="2.2"/><path d="M3.6 7.8a4.4 4.4 0 0 0 8.8 0M8 12.2v2.2M5.8 14.4h4.4"/></svg>',
  up: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10l4-4 4 4"/></svg>',
  down: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>',
  left: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4L6 8l4 4"/></svg>',
  right: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>',
  shift: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M8 2.5L2.5 8.5h3.2v4.8h4.6V8.5h3.2L8 2.5z"/></svg>',
  enter: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3.5v4.8H3.8M6.6 5.5L3.8 8.3l2.8 2.8"/></svg>',
};

function loadPrefs(): TouchKeyboardPrefs {
  try {
    const raw = preferences.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TouchKeyboardPrefs>;
      return {
        layout: parsed.layout === 'desktop' || parsed.layout === 'mobile' ? parsed.layout : 'auto',
        theme: parsed.theme === 'light' ? 'light' : 'dark',
        sound: Boolean(parsed.sound),
        haptics: parsed.haptics !== false,
      };
    }
  } catch {}
  return { layout: 'auto', theme: 'dark', sound: false, haptics: true };
}

function savePrefs(prefs: TouchKeyboardPrefs) {
  try {
    preferences.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

type EditableTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

function isEditableElement(el: EventTarget | null): el is EditableTarget {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest('[data-wow-touch-keyboard]')) return false;
  if (el instanceof HTMLInputElement) {
    const t = (el.type || 'text').toLowerCase();
    return !el.disabled && !el.readOnly && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'file', 'color'].includes(t);
  }
  if (el instanceof HTMLTextAreaElement) {
    return !el.disabled && !el.readOnly;
  }
  return el.isContentEditable;
}

function createTouchKeyboardController() {
  let open = false;
  let rootEl: HTMLElement | null = null;
  let prefs = loadPrefs();
  let shift = false;
  let caps = false;
  let fn = false;
  let imeChinese = true;
  let pinyinBuf = '';
  let mobilePage: MobilePage = 'abc';
  let activePanel: ActivePanel = 'none';
  let activeEmojiCat = 'common';
  let docked = true;
  let floatPos: { left: number; top: number } | null = null;
  let lastTarget: EditableTarget | null = null;
  let clipboardHistory: string[] = [];
  let audioCtx: AudioContext | null = null;
  let voiceRec: { stop: () => void } | null = null;
  let voiceListening = false;
  let globalListenersBound = false;
  const listeners = new Set<(isOpen: boolean) => void>();

  function notify() {
    listeners.forEach((fnCb) => fnCb(open));
  }

  function isMobileLayout(): boolean {
    if (prefs.layout === 'mobile') return true;
    if (prefs.layout === 'desktop') return false;
    return typeof window !== 'undefined' && window.innerWidth <= 720;
  }

  function playKeyFeedback() {
    if (prefs.haptics && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(8);
      } catch {}
    }
    if (prefs.sound && typeof window !== 'undefined') {
      try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        if (!audioCtx) audioCtx = new AC();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = 520;
        gain.gain.setValueAtTime(0.035, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.022);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.024);
      } catch {}
    }
  }

  function pushClipboard(text: string) {
    const clean = text.trim();
    if (!clean) return;
    clipboardHistory = [clean, ...clipboardHistory.filter((item) => item !== clean)].slice(0, 12);
    if (open && activePanel === 'clipboard') render();
  }

  function bindGlobalListeners() {
    if (globalListenersBound || typeof document === 'undefined') return;
    globalListenersBound = true;
    document.addEventListener(
      'focusin',
      (e) => {
        if (isEditableElement(e.target)) {
          lastTarget = e.target;
          if (e.target instanceof HTMLInputElement && e.target.type === 'password' && pinyinBuf) {
            pinyinBuf = '';
            if (open) render();
          }
        }
      },
      true,
    );
    document.addEventListener('copy', () => {
      const sel = window.getSelection()?.toString();
      if (sel) pushClipboard(sel);
    });
    document.addEventListener('cut', () => {
      const sel = window.getSelection()?.toString();
      if (sel) pushClipboard(sel);
    });
    window.addEventListener('resize', () => {
      if (!open) return;
      if (isMobileLayout()) docked = true;
      render();
    });
  }

  function resolveTarget(): EditableTarget | null {
    if (isEditableElement(document.activeElement)) {
      lastTarget = document.activeElement;
      return lastTarget;
    }
    if (lastTarget && lastTarget.isConnected) {
      return lastTarget;
    }
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('input, textarea, [contenteditable="true"]'),
    );
    for (const el of candidates) {
      if (!isEditableElement(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        lastTarget = el;
        return el;
      }
    }
    return null;
  }

  function isPasswordTarget(target: EditableTarget | null): boolean {
    return target instanceof HTMLInputElement && target.type === 'password';
  }

  function insertText(text: string) {
    const target = resolveTarget();
    if (!target) return;
    target.focus();
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      target.value = target.value.slice(0, start) + text + target.value.slice(end);
      const nextPos = start + text.length;
      try {
        target.setSelectionRange(nextPos, nextPos);
      } catch {}
      target.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (target.isContentEditable) {
      document.execCommand('insertText', false, text);
    }
  }

  function deleteBackward() {
    if (pinyinBuf.length > 0) {
      pinyinBuf = pinyinBuf.slice(0, -1);
      render();
      return;
    }
    const target = resolveTarget();
    if (!target) return;
    target.focus();
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      if (start !== end) {
        target.value = target.value.slice(0, start) + target.value.slice(end);
        try {
          target.setSelectionRange(start, start);
        } catch {}
      } else if (start > 0) {
        target.value = target.value.slice(0, start - 1) + target.value.slice(start);
        try {
          target.setSelectionRange(start - 1, start - 1);
        } catch {}
      }
      target.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (target.isContentEditable) {
      document.execCommand('delete');
    }
  }

  function deleteForward() {
    const target = resolveTarget();
    if (!target) return;
    target.focus();
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      if (start !== end) {
        target.value = target.value.slice(0, start) + target.value.slice(end);
        try {
          target.setSelectionRange(start, start);
        } catch {}
      } else if (start < target.value.length) {
        target.value = target.value.slice(0, start) + target.value.slice(start + 1);
        try {
          target.setSelectionRange(start, start);
        } catch {}
      }
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function moveCaret(delta: number) {
    const target = resolveTarget();
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    target.focus();
    const cur = target.selectionStart ?? target.value.length;
    const next = Math.max(0, Math.min(target.value.length, cur + delta));
    try {
      target.setSelectionRange(next, next);
    } catch {}
  }

  function getCandidates(buf: string): string[] {
    if (!buf) return [];
    const exact = PINYIN_DICT[buf] ?? [];
    if (exact.length > 0) return exact;
    const prefixMatches: string[] = [];
    for (const [py, chars] of Object.entries(PINYIN_DICT)) {
      if (py.startsWith(buf)) {
        for (const ch of chars) {
          if (!prefixMatches.includes(ch)) prefixMatches.push(ch);
          if (prefixMatches.length >= 7) return prefixMatches;
        }
      }
    }
    return prefixMatches;
  }

  function commitPinyin(text?: string) {
    if (!pinyinBuf) return;
    const out = text ?? getCandidates(pinyinBuf)[0] ?? pinyinBuf;
    pinyinBuf = '';
    insertText(out);
    render();
  }

  function stopVoice() {
    try {
      voiceRec?.stop();
    } catch {}
    voiceRec = null;
    voiceListening = false;
  }

  function toggleVoice() {
    if (voiceListening) {
      stopVoice();
      render();
      return;
    }
    const SR =
      (window as unknown as Record<string, unknown>).SpeechRecognition ??
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    if (typeof SR !== 'function') return;
    try {
      const rec = new (SR as new () => {
        lang: string;
        continuous: boolean;
        interimResults: boolean;
        onstart: (() => void) | null;
        onerror: (() => void) | null;
        onend: (() => void) | null;
        onresult: ((ev: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
        start: () => void;
        stop: () => void;
      })();
      rec.lang = imeChinese ? 'zh-CN' : 'en-US';
      rec.continuous = false;
      rec.interimResults = false;
      rec.onstart = () => {
        voiceListening = true;
        render();
      };
      rec.onerror = () => {
        voiceListening = false;
        voiceRec = null;
        render();
      };
      rec.onend = () => {
        voiceListening = false;
        voiceRec = null;
        if (open) render();
      };
      rec.onresult = (ev) => {
        const transcript = ev.results[ev.results.length - 1]?.[0]?.transcript?.trim();
        if (transcript) insertText(transcript);
      };
      voiceRec = rec;
      rec.start();
    } catch {
      voiceListening = false;
      voiceRec = null;
    }
  }

  function handleKey(spec: KeySpec, forceHint = false) {
    playKeyFeedback();
    const id = spec.id;
    if (forceHint && spec.hint) {
      if (pinyinBuf) commitPinyin();
      insertText(spec.hint);
      return;
    }
    if (id === 'ShiftL' || id === 'ShiftR') {
      shift = !shift;
      render();
      return;
    }
    if (id === 'Caps') {
      caps = !caps;
      if (caps && pinyinBuf) commitPinyin(pinyinBuf);
      render();
      return;
    }
    if (id === 'Fn') {
      fn = !fn;
      render();
      return;
    }
    if (id === 'Ime') {
      if (pinyinBuf) commitPinyin(pinyinBuf);
      imeChinese = !imeChinese;
      render();
      return;
    }
    if (id === 'PageNum') {
      if (pinyinBuf) commitPinyin();
      mobilePage = 'num';
      render();
      return;
    }
    if (id === 'PageSym') {
      if (pinyinBuf) commitPinyin();
      mobilePage = 'sym';
      render();
      return;
    }
    if (id === 'PageAbc') {
      mobilePage = 'abc';
      render();
      return;
    }
    if (id === 'Emoji') {
      activePanel = activePanel === 'emoji' ? 'none' : 'emoji';
      render();
      return;
    }
    if (id === 'Voice') {
      toggleVoice();
      return;
    }
    if (id === 'Esc') {
      if (pinyinBuf) {
        pinyinBuf = '';
        render();
        return;
      }
      if (activePanel !== 'none') {
        activePanel = 'none';
        render();
      }
      return;
    }
    if (id === 'Backspace') {
      deleteBackward();
      return;
    }
    if (id === 'Del') {
      deleteForward();
      return;
    }
    if (id === 'ArrowLeft') {
      moveCaret(-1);
      return;
    }
    if (id === 'ArrowRight') {
      moveCaret(1);
      return;
    }
    if (id === 'ArrowUp' || id === 'ArrowDown' || id === 'CtrlL' || id === 'CtrlR' || id === 'AltL' || id === 'AltR' || id === 'Win') {
      return;
    }
    if (id === 'Tab') {
      if (pinyinBuf) commitPinyin();
      const focusables = Array.from(
        document.querySelectorAll<HTMLElement>('input, textarea, select, button'),
      ).filter((el) => !el.closest('[data-wow-touch-keyboard]') && el.offsetParent !== null);
      const cur = resolveTarget();
      const idx = cur ? focusables.indexOf(cur) : -1;
      focusables[(idx + 1) % Math.max(1, focusables.length)]?.focus();
      return;
    }
    if (id === 'Enter') {
      if (pinyinBuf) {
        commitPinyin(pinyinBuf);
        return;
      }
      const target = resolveTarget();
      if (target instanceof HTMLTextAreaElement) {
        insertText('\n');
        return;
      }
      if (target instanceof HTMLInputElement) {
        if (target.form) {
          target.form.requestSubmit();
        } else {
          target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }
        return;
      }
      return;
    }
    if (id === 'Space') {
      if (pinyinBuf) {
        commitPinyin();
        return;
      }
      insertText(' ');
      return;
    }
    if (fn && spec.fnLabel) return;

    // 字符输入
    const target = resolveTarget();
    let out = '';
    if (spec.sub && spec.label) {
      if (pinyinBuf) commitPinyin();
      out = shift ? spec.sub : spec.label;
    } else if (spec.label && spec.label.length === 1 && /[a-z]/.test(spec.label)) {
      const upper = shift !== caps;
      if (imeChinese && !upper && !isPasswordTarget(target)) {
        pinyinBuf += spec.label;
        render();
        return;
      }
      if (pinyinBuf) commitPinyin(pinyinBuf);
      out = upper ? spec.label.toUpperCase() : spec.label;
    } else if (spec.label) {
      if (pinyinBuf) commitPinyin();
      out = spec.label;
    }
    if (out) {
      insertText(out);
      if (shift) {
        shift = false;
        render();
      }
    }
  }

  function applyPosition() {
    if (!rootEl) return;
    const mobile = isMobileLayout();
    const useDocked = mobile || docked;
    rootEl.classList.toggle('is-mobile', mobile);
    rootEl.classList.toggle('is-docked', useDocked);
    rootEl.classList.toggle('is-floating', !useDocked && floatPos !== null);
    rootEl.classList.toggle('is-light', prefs.theme === 'light');
    if (useDocked || !floatPos) {
      rootEl.style.left = '';
      rootEl.style.top = '';
      rootEl.style.bottom = '';
    } else {
      rootEl.style.left = `${floatPos.left}px`;
      rootEl.style.top = `${floatPos.top}px`;
      rootEl.style.bottom = 'auto';
    }
  }

  function renderPanel(panelEl: HTMLElement) {
    panelEl.replaceChildren();
    if (activePanel === 'settings') {
      const grid = document.createElement('div');
      grid.className = 'w11-tkb-settings-grid';

      const makeGroup = (title: string, buttons: Array<{ label: string; active: boolean; onClick: () => void }>) => {
        const g = document.createElement('div');
        g.className = 'w11-tkb-setting-group';
        const t = document.createElement('span');
        t.className = 'w11-tkb-setting-title';
        t.textContent = title;
        g.append(t);
        for (const b of buttons) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = b.active ? 'w11-tkb-chip is-active' : 'w11-tkb-chip';
          btn.textContent = b.label;
          btn.addEventListener('pointerdown', (e) => e.preventDefault());
          btn.addEventListener('click', () => {
            b.onClick();
            savePrefs(prefs);
            render();
          });
          g.append(btn);
        }
        return g;
      };

      grid.append(
        makeGroup('布局', [
          { label: '自动适配', active: prefs.layout === 'auto', onClick: () => (prefs.layout = 'auto') },
          { label: '桌面完整', active: prefs.layout === 'desktop', onClick: () => (prefs.layout = 'desktop') },
          { label: '手机紧凑', active: prefs.layout === 'mobile', onClick: () => (prefs.layout = 'mobile') },
        ]),
        makeGroup('主题', [
          { label: '深色 Fluent', active: prefs.theme === 'dark', onClick: () => (prefs.theme = 'dark') },
          { label: '浅色 Fluent', active: prefs.theme === 'light', onClick: () => (prefs.theme = 'light') },
        ]),
        makeGroup('反馈', [
          { label: prefs.sound ? '按键音：开' : '按键音：关', active: prefs.sound, onClick: () => (prefs.sound = !prefs.sound) },
          { label: prefs.haptics ? '触觉：开' : '触觉：关', active: prefs.haptics, onClick: () => (prefs.haptics = !prefs.haptics) },
        ]),
      );
      panelEl.append(grid);
      return;
    }

    if (activePanel === 'emoji') {
      const tabs = document.createElement('div');
      tabs.className = 'w11-tkb-emoji-tabs';
      for (const cat of EMOJI_CATEGORIES) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = cat.id === activeEmojiCat ? 'w11-tkb-chip is-active' : 'w11-tkb-chip';
        tab.textContent = cat.label;
        tab.addEventListener('pointerdown', (e) => e.preventDefault());
        tab.addEventListener('click', () => {
          activeEmojiCat = cat.id;
          render();
        });
        tabs.append(tab);
      }
      const grid = document.createElement('div');
      grid.className = 'w11-tkb-emoji-grid';
      const cur = EMOJI_CATEGORIES.find((c) => c.id === activeEmojiCat) ?? EMOJI_CATEGORIES[0];
      for (const em of cur.items) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'w11-tkb-emoji-btn';
        btn.textContent = em;
        btn.addEventListener('pointerdown', (e) => e.preventDefault());
        btn.addEventListener('click', () => {
          playKeyFeedback();
          insertText(em);
        });
        grid.append(btn);
      }
      panelEl.append(tabs, grid);
      return;
    }

    if (activePanel === 'clipboard') {
      const head = document.createElement('div');
      head.className = 'w11-tkb-clip-head';
      const title = document.createElement('span');
      title.textContent = '剪贴板历史';
      const btns = document.createElement('div');
      btns.style.display = 'flex';
      btns.style.gap = '6px';

      const readOsBtn = document.createElement('button');
      readOsBtn.type = 'button';
      readOsBtn.className = 'w11-tkb-chip';
      readOsBtn.textContent = '粘贴系统剪贴板';
      readOsBtn.addEventListener('pointerdown', (e) => e.preventDefault());
      readOsBtn.addEventListener('click', async () => {
        try {
          const text = await navigator.clipboard.readText();
          if (text) {
            pushClipboard(text);
            insertText(text);
          }
        } catch {}
      });

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'w11-tkb-chip';
      clearBtn.textContent = '清空';
      clearBtn.addEventListener('pointerdown', (e) => e.preventDefault());
      clearBtn.addEventListener('click', () => {
        clipboardHistory = [];
        render();
      });

      btns.append(readOsBtn, clearBtn);
      head.append(title, btns);
      panelEl.append(head);

      if (clipboardHistory.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'w11-tkb-clip-empty';
        empty.textContent = '暂无剪贴板记录。复制任意文字后会自动出现在这里，或点击右上角粘贴系统剪贴板。';
        panelEl.append(empty);
        return;
      }
      const list = document.createElement('div');
      list.className = 'w11-tkb-clip-list';
      for (const item of clipboardHistory) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'w11-tkb-clip-item';
        btn.textContent = item;
        btn.addEventListener('pointerdown', (e) => e.preventDefault());
        btn.addEventListener('click', () => {
          playKeyFeedback();
          insertText(item);
        });
        list.append(btn);
      }
      panelEl.append(list);
    }
  }

  function render() {
    if (!open) {
      rootEl?.remove();
      rootEl = null;
      return;
    }
    if (!rootEl) {
      rootEl = document.createElement('section');
      rootEl.className = 'w11-tkb';
      rootEl.dataset.wowTouchKeyboard = '1';
      rootEl.setAttribute('aria-label', '屏幕键盘');
      rootEl.addEventListener('click', (e) => e.stopPropagation());
      document.body.append(rootEl);
    }
    rootEl.replaceChildren();
    applyPosition();

    const mobile = isMobileLayout();

    // 顶部栏
    const bar = document.createElement('div');
    bar.className = 'w11-tkb-bar';

    const left = document.createElement('div');
    left.className = 'w11-tkb-bar-left';

    const makeTool = (iconHtml: string, title: string, active: boolean, onClick: () => void, extraClass = '') => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `w11-tkb-tool ${active ? 'is-active' : ''} ${extraClass}`.trim();
      btn.title = title;
      btn.setAttribute('aria-label', title);
      btn.innerHTML = iconHtml;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      btn.addEventListener('click', onClick);
      return btn;
    };

    left.append(
      makeTool(ICONS.settings, '键盘设置', activePanel === 'settings', () => {
        activePanel = activePanel === 'settings' ? 'none' : 'settings';
        render();
      }),
      makeTool(ICONS.emoji, '表情与符号', activePanel === 'emoji', () => {
        activePanel = activePanel === 'emoji' ? 'none' : 'emoji';
        render();
      }),
      makeTool(ICONS.clipboard, '剪贴板历史', activePanel === 'clipboard', () => {
        activePanel = activePanel === 'clipboard' ? 'none' : 'clipboard';
        render();
      }),
    );

    const center = document.createElement('div');
    center.className = 'w11-tkb-bar-center';
    if (pinyinBuf) {
      const bufEl = document.createElement('span');
      bufEl.className = 'w11-tkb-ime-buf';
      bufEl.textContent = pinyinBuf;
      center.append(bufEl);
      const cands = getCandidates(pinyinBuf);
      cands.slice(0, 7).forEach((cand, idx) => {
        const cBtn = document.createElement('button');
        cBtn.type = 'button';
        cBtn.className = idx === 0 ? 'w11-tkb-cand is-first' : 'w11-tkb-cand';
        cBtn.textContent = `${idx + 1}. ${cand}`;
        cBtn.addEventListener('pointerdown', (e) => e.preventDefault());
        cBtn.addEventListener('click', () => commitPinyin(cand));
        center.append(cBtn);
      });
      const rawBtn = document.createElement('button');
      rawBtn.type = 'button';
      rawBtn.className = 'w11-tkb-cand';
      rawBtn.textContent = pinyinBuf;
      rawBtn.addEventListener('pointerdown', (e) => e.preventDefault());
      rawBtn.addEventListener('click', () => commitPinyin(pinyinBuf));
      center.append(rawBtn);
    } else if (!mobile && !docked) {
      const grip = document.createElement('span');
      grip.className = 'w11-tkb-grip';
      center.append(grip);
    }

    const right = document.createElement('div');
    right.className = 'w11-tkb-bar-right';
    if (!mobile) {
      right.append(
        makeTool(docked ? ICONS.float : ICONS.dock, docked ? '切换为浮动键盘' : '停靠到底部', false, () => {
          docked = !docked;
          if (!docked && !floatPos && rootEl) {
            const w = Math.min(940, window.innerWidth - 24);
            floatPos = {
              left: Math.max(12, Math.round((window.innerWidth - w) / 2)),
              top: Math.max(12, window.innerHeight - 310),
            };
          }
          render();
        }),
      );
    }
    right.append(
      makeTool(ICONS.close, '关闭屏幕键盘', false, () => close(), 'is-close'),
    );

    bar.append(left, center, right);

    // 桌面浮动模式支持拖拽移动
    if (!mobile && !docked) {
      bar.addEventListener('pointerdown', (e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        e.preventDefault();
        const rect = rootEl!.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const offsetY = e.clientY - rect.top;
        const onMove = (ev: PointerEvent) => {
          const maxLeft = Math.max(0, window.innerWidth - rect.width);
          const maxTop = Math.max(0, window.innerHeight - 60);
          floatPos = {
            left: Math.max(0, Math.min(maxLeft, Math.round(ev.clientX - offsetX))),
            top: Math.max(0, Math.min(maxTop, Math.round(ev.clientY - offsetY))),
          };
          applyPosition();
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    }

    rootEl.append(bar);

    if (activePanel !== 'none') {
      const panelEl = document.createElement('div');
      panelEl.className = 'w11-tkb-panel';
      renderPanel(panelEl);
      rootEl.append(panelEl);
    }

    // 按键主体
    const keysWrap = document.createElement('div');
    keysWrap.className = 'w11-tkb-keys';

    const rows = mobile
      ? mobilePage === 'abc'
        ? MOBILE_ABC_ROWS
        : mobilePage === 'num'
          ? MOBILE_NUM_ROWS
          : MOBILE_SYM_ROWS
      : DESKTOP_ROWS;

    rows.forEach((row, rowIdx) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'w11-tkb-row';
      if (mobile && mobilePage === 'abc' && rowIdx === 1) {
        const sp = document.createElement('span');
        sp.className = 'w11-tkb-spacer';
        rowEl.append(sp);
      }

      for (const spec of row) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'w11-tkb-key';
        if (spec.kind === 'fn') btn.classList.add('is-fn');
        if (spec.align === 'left') btn.classList.add('is-align-left');
        if (spec.align === 'right') btn.classList.add('is-align-right');
        if (spec.flex) btn.style.flex = String(spec.flex);

        const isActive =
          ((spec.id === 'ShiftL' || spec.id === 'ShiftR') && shift) ||
          (spec.id === 'Caps' && caps) ||
          (spec.id === 'Fn' && fn);
        if (isActive) btn.classList.add('is-active');
        if (spec.id === 'Voice' && voiceListening) btn.classList.add('is-listening');
        if (spec.id === 'Ime' && !imeChinese) btn.classList.add('is-muted-label');

        if (spec.icon) {
          btn.innerHTML = ICONS[spec.icon];
        } else if (fn && spec.fnLabel) {
          btn.textContent = spec.fnLabel;
        } else if (spec.sub && spec.label) {
          const subEl = document.createElement('span');
          subEl.className = shift ? 'w11-tkb-sub is-primary' : 'w11-tkb-sub';
          subEl.textContent = spec.sub;
          const mainEl = document.createElement('span');
          mainEl.className = shift ? 'w11-tkb-main is-muted' : 'w11-tkb-main';
          mainEl.textContent = spec.label;
          btn.append(subEl, mainEl);
        } else if (spec.id === 'Ime') {
          btn.textContent = imeChinese ? '简体' : 'ENG';
        } else {
          const raw = spec.label ?? '';
          if (raw.length === 1 && /[a-z]/.test(raw)) {
            btn.textContent = shift !== caps ? raw.toUpperCase() : raw;
          } else {
            btn.textContent = raw;
          }
          if (mobile && spec.hint) {
            const h = document.createElement('span');
            h.className = 'w11-tkb-hint';
            h.textContent = spec.hint;
            btn.append(h);
          }
        }

        // 防止抢占输入框焦点，支持移动端长按数字提示与连发退格/方向键
        const isRepeatable = spec.id === 'Backspace' || spec.id === 'ArrowLeft' || spec.id === 'ArrowRight';
        let holdTimer: number | null = null;
        let repeatTimer: number | null = null;
        let didHoldAction = false;
        let popupEl: HTMLElement | null = null;

        const clearTimers = () => {
          if (holdTimer !== null) {
            window.clearTimeout(holdTimer);
            holdTimer = null;
          }
          if (repeatTimer !== null) {
            window.clearInterval(repeatTimer);
            repeatTimer = null;
          }
          popupEl?.remove();
          popupEl = null;
          btn.classList.remove('is-pressed');
        };

        btn.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          didHoldAction = false;
          btn.classList.add('is-pressed');

          if (mobile && spec.kind !== 'fn' && spec.id !== 'Space' && btn.textContent) {
            popupEl = document.createElement('span');
            popupEl.className = 'w11-tkb-popup';
            popupEl.textContent = spec.label && spec.label.length === 1 && /[a-z]/.test(spec.label)
              ? shift !== caps
                ? spec.label.toUpperCase()
                : spec.label
              : spec.label ?? '';
            btn.append(popupEl);
          }

          if (isRepeatable) {
            holdTimer = window.setTimeout(() => {
              didHoldAction = true;
              repeatTimer = window.setInterval(() => handleKey(spec), 58);
            }, 380);
          } else if (mobile && spec.hint) {
            holdTimer = window.setTimeout(() => {
              didHoldAction = true;
              if (popupEl) popupEl.textContent = spec.hint!;
              handleKey(spec, true);
            }, 420);
          }
        });

        btn.addEventListener('pointerup', clearTimers);
        btn.addEventListener('pointerleave', clearTimers);
        btn.addEventListener('pointercancel', clearTimers);
        btn.addEventListener('click', () => {
          if (didHoldAction) {
            didHoldAction = false;
            return;
          }
          handleKey(spec);
        });

        rowEl.append(btn);
      }

      if (mobile && mobilePage === 'abc' && rowIdx === 1) {
        const sp = document.createElement('span');
        sp.className = 'w11-tkb-spacer';
        rowEl.append(sp);
      }
      keysWrap.append(rowEl);
    });

    rootEl.append(keysWrap);
  }

  function openKeyboard() {
    bindGlobalListeners();
    if (open) {
      render();
      return;
    }
    open = true;
    docked = isMobileLayout() ? true : false;
    if (!docked && !floatPos) {
      const w = Math.min(940, window.innerWidth - 24);
      floatPos = {
        left: Math.max(12, Math.round((window.innerWidth - w) / 2)),
        top: Math.max(12, window.innerHeight - 308),
      };
    }
    render();
    notify();
  }

  function close() {
    if (!open) return;
    open = false;
    pinyinBuf = '';
    activePanel = 'none';
    stopVoice();
    render();
    notify();
  }

  function toggle() {
    if (open) close();
    else openKeyboard();
  }

  return {
    open: openKeyboard,
    close,
    toggle,
    isOpen: () => open,
    subscribe(cb: (isOpen: boolean) => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

export const touchKeyboardController = createTouchKeyboardController();
