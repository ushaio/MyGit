Unicode true

####
## Please note: Template replacements don't work in this file. They are provided with default defines like
## mentioned underneath.
## If the keyword is not defined, "wails_tools.nsh" will populate them.
## If they are defined here, "wails_tools.nsh" will not touch them. This allows you to use this project.nsi manually
## from outside of Wails for debugging and development of the installer.
## 
## For development first make a wails nsis build to populate the "wails_tools.nsh":
## > wails build --target windows/amd64 --nsis
## Then you can call makensis on this file with specifying the path to your binary:
## For a AMD64 only installer:
## > makensis -DARG_WAILS_AMD64_BINARY=..\..\bin\app.exe
## For a ARM64 only installer:
## > makensis -DARG_WAILS_ARM64_BINARY=..\..\bin\app.exe
## For a installer with both architectures:
## > makensis -DARG_WAILS_AMD64_BINARY=..\..\bin\app-amd64.exe -DARG_WAILS_ARM64_BINARY=..\..\bin\app-arm64.exe
####
## The following information is taken from the wails_tools.nsh file, but they can be overwritten here.
####
## !define INFO_PROJECTNAME    "my-project" # Default "MyGit"
## !define INFO_COMPANYNAME    "My Company" # Default "MyGit"
## !define INFO_PRODUCTNAME    "My Product Name" # Default "MyGit"
## !define INFO_PRODUCTVERSION "1.0.0"     # Default "0.1.0"
## !define INFO_COPYRIGHT      "(c) Now, My Company" # Default "Copyright 2026 MyGit contributors"
###
## !define PRODUCT_EXECUTABLE  "Application.exe"      # Default "${INFO_PROJECTNAME}.exe"
## !define UNINST_KEY_NAME     "UninstKeyInRegistry"  # Default "${INFO_COMPANYNAME}${INFO_PRODUCTNAME}"
####
## !define REQUEST_EXECUTION_LEVEL "admin"            # Default "admin"  see also https://nsis.sourceforge.io/Docs/Chapter4.html
## !define WAILS_INSTALL_SCOPE     "user"             # Default "machine" - set to "user" for per-user install ($LOCALAPPDATA) without UAC prompt
####
## Include the wails tools
####
!include "wails_tools.nsh"

# The version information for this two must consist of 4 parts
VIProductVersion "${INFO_PRODUCTVERSION}.0"
VIFileVersion    "${INFO_PRODUCTVERSION}.0"

VIAddVersionKey "CompanyName"     "${INFO_COMPANYNAME}"
VIAddVersionKey "FileDescription" "${INFO_PRODUCTNAME} Installer"
VIAddVersionKey "ProductVersion"  "${INFO_PRODUCTVERSION}"
VIAddVersionKey "FileVersion"     "${INFO_PRODUCTVERSION}"
VIAddVersionKey "LegalCopyright"  "${INFO_COPYRIGHT}"
VIAddVersionKey "ProductName"     "${INFO_PRODUCTNAME}"

# Enable HiDPI support. https://nsis.sourceforge.io/Reference/ManifestDPIAware
ManifestDPIAware true

!include "MUI.nsh"

!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
# !define MUI_WELCOMEFINISHPAGE_BITMAP "resources\leftimage.bmp" #Include this to add a bitmap on the left side of the Welcome Page. Must be a size of 164x314
!define MUI_FINISHPAGE_NOAUTOCLOSE # Wait on the INSTFILES page so the user can take a look into the details of the installation steps
!define MUI_ABORTWARNING # This will warn the user if they exit from the installer.

!insertmacro MUI_PAGE_WELCOME # Welcome to the installer page.
# !insertmacro MUI_PAGE_LICENSE "resources\eula.txt" # Adds a EULA page to the installer
!insertmacro MUI_PAGE_DIRECTORY # In which folder install page.
!insertmacro MUI_PAGE_INSTFILES # Installing page.
!insertmacro MUI_PAGE_FINISH # Finished installation page.

!insertmacro MUI_UNPAGE_INSTFILES # Uninstalling page

!insertmacro MUI_LANGUAGE "English" # Set the Language of the installer

## The following two statements can be used to sign the installer and the uninstaller. The path to the binaries are provided in %1
#!uninstfinalize 'signtool --file "%1"'
#!finalize 'signtool --file "%1"'

Name "${INFO_PRODUCTNAME}"

# Artifact filename carries the product version and architecture for clarity,
# e.g. MyGit-0.3.1-amd64-installer.exe
OutFile "..\..\..\bin\${INFO_PROJECTNAME}-${INFO_PRODUCTVERSION}-${ARCH}-installer.exe" # Name of the installer's file.
!if "${WAILS_INSTALL_SCOPE}" == "user"
    InstallDir "$LOCALAPPDATA\Programs\${INFO_PRODUCTNAME}"
!else
    InstallDir "$PROGRAMFILES64\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}"
!endif
ShowInstDetails show # This will always show the installation details.

Function .onInit
   SetRegView 64

   ; Reuse the directory chosen the last time the app was installed, so upgrades
   ; do not require picking the location again. The key is removed on uninstall.
   !if "${WAILS_INSTALL_SCOPE}" == "user"
       ReadRegStr $0 HKCU "${UNINST_KEY}" "InstallLocation"
   !else
       ReadRegStr $0 HKLM "${UNINST_KEY}" "InstallLocation"
   !endif
   ${If} $0 != ""
       StrCpy $INSTDIR $0
   ${EndIf}

   !insertmacro wails.checkArchitecture

   ; Close a running instance before we overwrite files.
   Call EnsureAppClosed
FunctionEnd

; If a running instance is detected, offer to close it and continue. Loops until
; the process is gone (or the user aborts).
Function EnsureAppClosed
   StrCpy $R5 0
   StrCpy $R6 0
   ensure_check:
   nsExec::ExecToStack 'cmd /C tasklist /FI "IMAGENAME eq ${PRODUCT_EXECUTABLE}" /NH | findstr /I /C:"${PRODUCT_EXECUTABLE}" >nul'
   Pop $0
   Pop $1
   ${If} $0 != 0
       Return
   ${EndIf}
   ${If} $R5 == 0
       MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "${INFO_PRODUCTNAME} is currently running. Setup must close it before continuing.$\r$\n$\r$\nClose it and continue the installation?" IDOK ensure_close IDCANCEL ensure_abort
       StrCpy $R5 1
   ${EndIf}
   ensure_close:
   nsExec::ExecToStack 'cmd /C taskkill /F /IM ${PRODUCT_EXECUTABLE}'
   Pop $0
   Pop $1
   Sleep 1000
   IntOp $R6 $R6 + 1
   ${If} $R6 >= 12
       MessageBox MB_OK|MB_ICONSTOP "Could not close ${INFO_PRODUCTNAME}. Please close it manually and run Setup again."
       Abort
   ${EndIf}
   Goto ensure_check
   ensure_abort:
   Abort
FunctionEnd

Section
    !insertmacro wails.setShellContext

    !insertmacro wails.webview2runtime

    SetOutPath $INSTDIR
    
    !insertmacro wails.files

    ; Remember the install location so upgrades can preselect it.
    SetRegView 64
    !if "${WAILS_INSTALL_SCOPE}" == "user"
        WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
    !else
        WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
    !endif

    CreateShortcut "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
    CreateShortCut "$DESKTOP\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"

    !insertmacro wails.associateFiles
    !insertmacro wails.associateCustomProtocols
    
    !insertmacro wails.writeUninstaller
SectionEnd

Section "uninstall" 
    !insertmacro wails.setShellContext

    RMDir /r "$AppData\${PRODUCT_EXECUTABLE}" # Remove the WebView2 DataPath

    RMDir /r $INSTDIR

    Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${INFO_PRODUCTNAME}.lnk"

    !insertmacro wails.unassociateFiles
    !insertmacro wails.unassociateCustomProtocols

    !insertmacro wails.deleteUninstaller
SectionEnd
