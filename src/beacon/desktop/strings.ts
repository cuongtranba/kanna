import type { BeaconActivityVerb } from "../activity"

export type DesktopLocale = "en" | "vi"

export interface DesktopStrings {
  appName: string
  status: {
    connecting: string
    reconnecting: string
    online: string
    onlineSince: (time: string) => string
    offline: string
    retryIn: (seconds: number) => string
    switchedOff: string
    switchedOffDetail: string
    paused: string
    pausedDetail: string
    revoked: string
    revokedDetail: string
    incompatible: string
    incompatibleDetail: string
    updating: string
    updatingDetail: (version: string) => string
    restartingDetail: (version: string) => string
    updateFailedDetail: (error: string) => string
    notPaired: string
  }
  grantSummary: {
    heading: string
    mayRead: string
    nothingShared: string
    commands: string
    commandsOff: string
    commandsOn: string
    approval: string
    approvalAsk: string
    approvalAuto: string
    change: string
    waitingForScope: string
  }
  record: {
    heading: string
    empty: string
    today: string
    yesterday: string
    verbs: Record<BeaconActivityVerb, string>
    done: string
    exit: (code: number) => string
    failed: string
    refused: string
  }
  footer: {
    pause: string
    resume: string
    more: string
    launchAtLogin: (os: string) => string
    unpair: string
    unpairConfirm: (kanna: string) => string
    unpairConfirmAction: string
    cancel: string
    download: string
    pairAgain: string
  }
  welcome: {
    title: string
    lead: string
    stepOpenKanna: string
    stepClickLink: string
    waiting: string
    pasteLabel: string
    pastePlaceholder: string
    pasteSubmit: string
    pasteRejected: string
    downloadNote: string
  }
  confirm: {
    title: string
    appearsAs: (machine: string) => string
    warning: string
    connect: string
    connecting: string
    cancel: string
    errors: {
      expired: string
      unknownCode: string
      needsPassword: string
      unreachable: (detail: string) => string
      other: (detail: string) => string
    }
  }
  grant: {
    titleFirstRun: string
    titleEdit: string
    foldersHeading: string
    foldersHint: string
    foldersEmpty: string
    addFolder: string
    removeFolder: (folder: string) => string
    commandsHeading: string
    allowCommands: string
    allowCommandsHint: string
    askFirst: string
    askFirstHint: string
    consentTitle: string
    consentBody: string
    consentAgree: string
    launchAtLogin: (os: string) => string
    save: string
    saving: string
    skip: string
    cancel: string
    waitingOnline: string
    errors: {
      offline: string
      rejected: string
      needsNewerKanna: string
    }
  }
  notices: {
    unpaired: string
    unpairedNotInformed: (machine: string) => string
    alreadyPaired: (kanna: string) => string
    dismiss: string
  }
  tray: {
    open: string
    pause: string
    resume: string
    quit: string
  }
  osName: Record<"windows" | "darwin" | "linux", string>
}

const EN: DesktopStrings = {
  appName: "Kanna Beacon",
  status: {
    connecting: "Connecting",
    reconnecting: "Reconnecting",
    online: "Online",
    onlineSince: (time) => `since ${time}`,
    offline: "Offline",
    retryIn: (seconds) => `trying again in ${seconds}s`,
    switchedOff: "Switched off in Kanna",
    switchedOffDetail: "Turn this computer back on in Kanna, Settings, Beacons.",
    paused: "Paused",
    pausedDetail: "Kanna can't reach this computer until you resume.",
    revoked: "Removed from Kanna",
    revokedDetail: "This computer was removed in Kanna. Pair it again to reconnect.",
    incompatible: "Update needed",
    incompatibleDetail: "This version of Kanna Beacon is too old for your Kanna.",
    updating: "Updating",
    updatingDetail: (version) => `installing version ${version}`,
    restartingDetail: (version) => `restarting into version ${version}`,
    updateFailedDetail: (error) => `Updating itself failed: ${error}.`,
    notPaired: "Not paired",
  },
  grantSummary: {
    heading: "What Kanna may use",
    mayRead: "May read",
    nothingShared: "No folders. Kanna can't read anything here.",
    commands: "Commands",
    commandsOff: "Not allowed",
    commandsOn: "Allowed",
    approval: "Approval",
    approvalAsk: "Asks you in Kanna first",
    approvalAuto: "Acts without asking",
    change: "Change",
    waitingForScope: "Waiting for Kanna",
  },
  record: {
    heading: "Record",
    empty: "Nothing yet. When Kanna reads a file or runs a command on this computer, it is written here.",
    today: "Today",
    yesterday: "Yesterday",
    verbs: {
      read: "Read",
      list: "Looked at",
      search: "Searched",
      run: "Ran",
      script: "Ran script",
      send: "Sent to Kanna",
      receive: "Received from Kanna",
    },
    done: "Done",
    exit: (code) => (code === 0 ? "Finished" : `Exited ${code}`),
    failed: "Failed",
    refused: "Refused",
  },
  footer: {
    pause: "Pause",
    resume: "Resume",
    more: "More",
    launchAtLogin: (os) => `Start when I sign in to ${os}`,
    unpair: "Unpair this computer",
    unpairConfirm: (kanna) => `Unpair from ${kanna}? Kanna loses access right away, and this computer forgets its key.`,
    unpairConfirmAction: "Unpair",
    cancel: "Cancel",
    download: "Download the latest version",
    pairAgain: "Pair again",
  },
  welcome: {
    title: "Connect this computer to your Kanna",
    lead: "Kanna Beacon lets your Kanna agent read the folders you choose here, and run commands only if you allow it.",
    stepOpenKanna: "In Kanna, open Settings, Beacons, and choose Pair a machine.",
    stepClickLink: "Click Open in Kanna Beacon. This window fills in the rest.",
    waiting: "Waiting for the link from Kanna",
    pasteLabel: "Or paste the pairing link or command",
    pastePlaceholder: "kanna-beacon pair https://… CODE",
    pasteSubmit: "Continue",
    pasteRejected: "That isn't a pairing link or command. Copy it again from Kanna, Settings, Beacons.",
    downloadNote: "Codes expire after five minutes. If yours has, choose Pair a machine again.",
  },
  confirm: {
    title: "Connect to this Kanna?",
    appearsAs: (machine) => `This computer will appear in Kanna as ${machine}.`,
    warning:
      "Only continue if this is your own Kanna. Anyone who can sign in to it can reach this computer, within the limits you set next.",
    connect: "Connect",
    connecting: "Connecting",
    cancel: "Cancel",
    errors: {
      expired: "This code has expired. In Kanna, choose Pair a machine again and click the new link.",
      unknownCode: "Kanna doesn't recognise this code. It may already have been used. Get a new one in Kanna.",
      needsPassword: "This Kanna has no password, so it can't pair machines. Set a password in Kanna first.",
      unreachable: (detail) => `Can't reach this Kanna (${detail}). Check the address and your connection.`,
      other: (detail) => `Kanna refused the pairing: ${detail}`,
    },
  },
  grant: {
    titleFirstRun: "What may Kanna use on this computer?",
    titleEdit: "Change what Kanna may use",
    foldersHeading: "Folders Kanna may read",
    foldersHint: "Kanna sees nothing outside these folders.",
    foldersEmpty: "No folders yet.",
    addFolder: "Add folder",
    removeFolder: (folder) => `Remove ${folder}`,
    commandsHeading: "Commands and approval",
    allowCommands: "Let Kanna run commands",
    allowCommandsHint: "Commands run with your account's permissions on this computer.",
    askFirst: "Ask me in Kanna before each read or command",
    askFirstHint: "You approve every action in the chat before it happens.",
    consentTitle: "Run without asking?",
    consentBody:
      "Kanna will read inside your folders and run commands on this computer without asking each time. Anyone who can sign in to your Kanna can do the same. You can turn asking back on here at any time.",
    consentAgree: "I understand, and I want Kanna to act without asking",
    launchAtLogin: (os) => `Start Kanna Beacon when I sign in to ${os}`,
    save: "Save",
    saving: "Saving",
    skip: "Skip for now",
    cancel: "Cancel",
    waitingOnline: "Saving is available once this computer is connected to Kanna.",
    errors: {
      offline: "Couldn't save while offline. Your choices are kept here; try again once connected.",
      rejected: "Kanna didn't accept these folders. Pick folders on this computer and try again.",
      needsNewerKanna: "Your Kanna is too old to take changes from here. Update Kanna, or set this in Kanna, Settings, Beacons.",
    },
  },
  notices: {
    unpaired: "This computer is no longer paired.",
    unpairedNotInformed: (machine) =>
      `Kanna couldn't be told, so ${machine} still appears there. Revoke it in Kanna, Settings, Beacons.`,
    alreadyPaired: (kanna) => `This computer is already paired with ${kanna}. Unpair it first to pair with another Kanna.`,
    dismiss: "Dismiss",
  },
  tray: {
    open: "Open Kanna Beacon",
    pause: "Pause",
    resume: "Resume",
    quit: "Quit Kanna Beacon",
  },
  osName: { windows: "Windows", darwin: "macOS", linux: "Linux" },
}

const VI: DesktopStrings = {
  appName: "Kanna Beacon",
  status: {
    connecting: "Đang kết nối",
    reconnecting: "Đang kết nối lại",
    online: "Đã kết nối",
    onlineSince: (time) => `từ ${time}`,
    offline: "Mất kết nối",
    retryIn: (seconds) => `thử lại sau ${seconds} giây`,
    switchedOff: "Đã tắt trong Kanna",
    switchedOffDetail: "Bật lại máy này trong Kanna, Settings, Beacons.",
    paused: "Đã tạm dừng",
    pausedDetail: "Kanna không với tới máy này cho đến khi bạn tiếp tục.",
    revoked: "Đã bị gỡ khỏi Kanna",
    revokedDetail: "Máy này đã bị gỡ trong Kanna. Ghép đôi lại để kết nối.",
    incompatible: "Cần cập nhật",
    incompatibleDetail: "Phiên bản Kanna Beacon này đã quá cũ so với Kanna của bạn.",
    updating: "Đang cập nhật",
    updatingDetail: (version) => `đang cài phiên bản ${version}`,
    restartingDetail: (version) => `đang khởi động lại vào phiên bản ${version}`,
    updateFailedDetail: (error) => `Tự cập nhật không thành công: ${error}.`,
    notPaired: "Chưa ghép đôi",
  },
  grantSummary: {
    heading: "Kanna được dùng gì",
    mayRead: "Được đọc",
    nothingShared: "Chưa có thư mục nào. Kanna không đọc được gì ở đây.",
    commands: "Chạy lệnh",
    commandsOff: "Không cho phép",
    commandsOn: "Cho phép",
    approval: "Phê duyệt",
    approvalAsk: "Hỏi bạn trong Kanna trước",
    approvalAuto: "Làm mà không hỏi",
    change: "Thay đổi",
    waitingForScope: "Đang chờ Kanna",
  },
  record: {
    heading: "Nhật ký",
    empty: "Chưa có gì. Khi Kanna đọc tệp hay chạy lệnh trên máy này, mọi việc sẽ được ghi ở đây.",
    today: "Hôm nay",
    yesterday: "Hôm qua",
    verbs: {
      read: "Đọc",
      list: "Xem",
      search: "Tìm",
      run: "Chạy",
      script: "Chạy script",
      send: "Gửi lên Kanna",
      receive: "Nhận từ Kanna",
    },
    done: "Xong",
    exit: (code) => (code === 0 ? "Hoàn tất" : `Thoát mã ${code}`),
    failed: "Lỗi",
    refused: "Bị chặn",
  },
  footer: {
    pause: "Tạm dừng",
    resume: "Tiếp tục",
    more: "Thêm",
    launchAtLogin: (os) => `Mở khi đăng nhập ${os}`,
    unpair: "Hủy ghép đôi máy này",
    unpairConfirm: (kanna) =>
      `Hủy ghép đôi với ${kanna}? Kanna mất quyền truy cập ngay, và máy này xóa khóa của nó.`,
    unpairConfirmAction: "Hủy ghép đôi",
    cancel: "Thôi",
    download: "Tải phiên bản mới nhất",
    pairAgain: "Ghép đôi lại",
  },
  welcome: {
    title: "Kết nối máy tính này với Kanna của bạn",
    lead: "Kanna Beacon cho agent trong Kanna đọc những thư mục bạn chọn ở đây, và chỉ chạy lệnh khi bạn cho phép.",
    stepOpenKanna: "Trong Kanna, mở Settings, Beacons, rồi chọn Pair a machine.",
    stepClickLink: "Bấm Open in Kanna Beacon. Cửa sổ này sẽ tự điền phần còn lại.",
    waiting: "Đang chờ liên kết từ Kanna",
    pasteLabel: "Hoặc dán liên kết hay lệnh ghép đôi",
    pastePlaceholder: "kanna-beacon pair https://… MÃ",
    pasteSubmit: "Tiếp tục",
    pasteRejected: "Đây không phải liên kết hay lệnh ghép đôi. Hãy sao chép lại từ Kanna, Settings, Beacons.",
    downloadNote: "Mã hết hạn sau năm phút. Nếu đã hết hạn, hãy chọn Pair a machine lần nữa.",
  },
  confirm: {
    title: "Kết nối với Kanna này?",
    appearsAs: (machine) => `Máy tính này sẽ hiện trong Kanna với tên ${machine}.`,
    warning:
      "Chỉ tiếp tục nếu đây là Kanna của chính bạn. Ai đăng nhập được vào đó cũng với tới được máy này, trong giới hạn bạn đặt ở bước sau.",
    connect: "Kết nối",
    connecting: "Đang kết nối",
    cancel: "Thôi",
    errors: {
      expired: "Mã này đã hết hạn. Trong Kanna, chọn Pair a machine lần nữa rồi bấm liên kết mới.",
      unknownCode: "Kanna không nhận ra mã này, có thể nó đã được dùng. Hãy lấy mã mới trong Kanna.",
      needsPassword: "Kanna này chưa đặt mật khẩu nên không ghép đôi được. Hãy đặt mật khẩu cho Kanna trước.",
      unreachable: (detail) => `Không kết nối được tới Kanna này (${detail}). Kiểm tra địa chỉ và mạng của bạn.`,
      other: (detail) => `Kanna từ chối ghép đôi: ${detail}`,
    },
  },
  grant: {
    titleFirstRun: "Kanna được dùng gì trên máy này?",
    titleEdit: "Thay đổi quyền của Kanna",
    foldersHeading: "Thư mục Kanna được đọc",
    foldersHint: "Kanna không thấy gì bên ngoài các thư mục này.",
    foldersEmpty: "Chưa có thư mục nào.",
    addFolder: "Thêm thư mục",
    removeFolder: (folder) => `Bỏ ${folder}`,
    commandsHeading: "Lệnh và phê duyệt",
    allowCommands: "Cho Kanna chạy lệnh",
    allowCommandsHint: "Lệnh chạy với quyền của tài khoản bạn trên máy này.",
    askFirst: "Hỏi tôi trong Kanna trước mỗi lần đọc hoặc chạy lệnh",
    askFirstHint: "Bạn duyệt từng việc trong khung chat trước khi nó diễn ra.",
    consentTitle: "Chạy không cần hỏi?",
    consentBody:
      "Kanna sẽ đọc trong các thư mục của bạn và chạy lệnh trên máy này mà không hỏi lại mỗi lần. Ai đăng nhập được vào Kanna của bạn cũng làm được như vậy. Bạn có thể bật lại chế độ hỏi ở đây bất cứ lúc nào.",
    consentAgree: "Tôi hiểu, và tôi muốn Kanna làm mà không cần hỏi",
    launchAtLogin: (os) => `Mở Kanna Beacon khi tôi đăng nhập ${os}`,
    save: "Lưu",
    saving: "Đang lưu",
    skip: "Để sau",
    cancel: "Thôi",
    waitingOnline: "Có thể lưu khi máy này đã kết nối với Kanna.",
    errors: {
      offline: "Không lưu được vì đang mất kết nối. Lựa chọn của bạn vẫn giữ ở đây; thử lại khi đã kết nối.",
      rejected: "Kanna không nhận các thư mục này. Hãy chọn thư mục trên máy này rồi thử lại.",
      needsNewerKanna: "Kanna của bạn quá cũ để nhận thay đổi từ đây. Hãy cập nhật Kanna, hoặc đặt trong Kanna, Settings, Beacons.",
    },
  },
  notices: {
    unpaired: "Máy này không còn ghép đôi nữa.",
    unpairedNotInformed: (machine) =>
      `Không báo được cho Kanna nên ${machine} vẫn còn hiện ở đó. Hãy gỡ nó trong Kanna, Settings, Beacons.`,
    alreadyPaired: (kanna) => `Máy này đã ghép đôi với ${kanna}. Hãy hủy ghép đôi trước khi ghép với Kanna khác.`,
    dismiss: "Đóng",
  },
  tray: {
    open: "Mở Kanna Beacon",
    pause: "Tạm dừng",
    resume: "Tiếp tục",
    quit: "Thoát Kanna Beacon",
  },
  osName: { windows: "Windows", darwin: "macOS", linux: "Linux" },
}

const STRINGS: Record<DesktopLocale, DesktopStrings> = { en: EN, vi: VI }

export function pickDesktopLocale(languages: readonly string[]): DesktopLocale {
  const first = languages.find((language) => language.trim().length > 0) ?? "en"
  return first.toLowerCase().startsWith("vi") ? "vi" : "en"
}

export function desktopStrings(locale: DesktopLocale): DesktopStrings {
  return STRINGS[locale]
}
