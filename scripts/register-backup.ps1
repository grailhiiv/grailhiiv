$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
$taskName = 'GrailHiiv Local Backup'
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask -and $existingTask.Actions.WorkingDirectory -ne $taskRoot) {
    throw 'A backup task for another checkout already uses this name.'
}
$taskCommand = "& '$($taskNode.Replace("'", "''"))' --env-file=.env --import tsx scripts/backup.ts; exit `$LASTEXITCODE"
$taskArguments = '-NoProfile -WindowStyle Hidden -Command "' + $taskCommand + '"'
$taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArguments -WorkingDirectory $taskRoot
$taskTrigger = New-ScheduledTaskTrigger -Daily -At '02:00'
$taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Hours 1) -ExecutionTimeLimit (New-TimeSpan -Hours 2)
$taskUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger -Settings $taskSettings -Principal $taskPrincipal -Description 'Encrypted local GrailHiiv backups with isolated restore verification. Runs while this user is signed in and Docker is available.' -Force | Select-Object TaskName, State
