Set shell = CreateObject("WScript.Shell")
batPath = "C:\restaurant-app\Inicio_Servidor.bat"

exitCode = shell.Run("cmd /c """ & batPath & """", 0, False)

If exitCode <> 0 Then
    Set fso = CreateObject("Scripting.FileSystemObject")
    logFile = shell.ExpandEnvironmentStrings("%TEMP%\pos-error.log")

    If fso.FileExists(logFile) Then
        Set file = fso.OpenTextFile(logFile, 1)
        errorText = file.ReadAll
        file.Close
        MsgBox "El servidor POS no pudo iniciarse:" & vbCrLf & vbCrLf & errorText, vbCritical, "Error al iniciar servidor"
    Else
        MsgBox "El servidor POS falló al iniciar, pero no se encontró el detalle del error.", vbCritical, "Error al iniciar servidor"
    End If
Else
    MsgBox "El servidor POS se ha iniciado correctamente.", vbExclamation, "Servidor Iniciado"
End If

