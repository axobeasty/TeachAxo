!macro KillTeachAxoAgentProcesses
  nsExec::ExecToLog 'taskkill /F /T /IM "TeachAxo Agent.exe"'
  Pop $0
  nsExec::ExecToLog 'taskkill /F /T /IM "teachaxo-agent.exe"'
  Pop $0
!macroend

!macro customInit
  !insertmacro KillTeachAxoAgentProcesses
!macroend

!macro customUnInstall
  !insertmacro KillTeachAxoAgentProcesses
!macroend
