; 捞捞编程 Windows 安装包（Inno Setup 6）。GitHub Actions 里用：
;   iscc /DAppVersion=1.0.x /DSrcDir=<electron-builder 的 win-unpacked> /DZhIsl=<ChineseSimplified.isl> laolao-code.iss
; 安装包里有编译器和本地模型，约 1.5 GB：用 Inno Setup（NSIS 打这么大的包容易出错）。
; 装在用户自己的目录（不用管理员权限），不改系统 PATH。

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SrcDir
  #define SrcDir "..\dist\win-unpacked"
#endif

[Setup]
AppId={{6E2C1F4B-7A51-4C3B-9C1E-5A0C0DE00001}
AppName=捞捞编程
AppVersion={#AppVersion}
AppVerName=捞捞编程 {#AppVersion}
AppPublisher=捞捞
AppPublisherURL=https://www.laolaokechengbiao.cn/code/
AppSupportURL=https://www.laolaokechengbiao.cn/code/
DefaultDirName={localappdata}\Programs\LaolaoCode
DefaultGroupName=捞捞编程
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\dist
OutputBaseFilename=LaolaoCode-Setup
SetupIconFile=..\build\icon.ico
UninstallDisplayIcon={app}\LaolaoCode.exe
UninstallDisplayName=捞捞编程
Compression=lzma2/fast
SolidCompression=no
LZMANumBlockThreads=4
DiskSpanning=no
WizardStyle=modern
ShowLanguageDialog=no
CloseApplications=yes

[Languages]
#ifdef ZhIsl
Name: "zh"; MessagesFile: "{#ZhIsl}"
#else
Name: "en"; MessagesFile: "compiler:Default.isl"
#endif

[Tasks]
Name: "desktopicon"; Description: "在桌面创建快捷方式"; GroupDescription: "快捷方式："

[Files]
; 模型文件本身压不小，直接存（省打包时间）
Source: "{#SrcDir}\resources\models\*"; DestDir: "{app}\resources\models"; Flags: ignoreversion recursesubdirs createallsubdirs nocompression
Source: "{#SrcDir}\*"; Excludes: "\resources\models\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\捞捞编程"; Filename: "{app}\LaolaoCode.exe"
Name: "{autodesktop}\捞捞编程"; Filename: "{app}\LaolaoCode.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\LaolaoCode.exe"; Description: "打开捞捞编程"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; 编译出来的临时程序、下载到一半的东西（你写的代码在「文档\捞捞编程」，不会删）
Type: filesandordirs; Name: "{userappdata}\LaolaoCode\build"
Type: filesandordirs; Name: "{userappdata}\LaolaoCode\toolchains\.downloads"
