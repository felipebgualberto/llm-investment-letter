@echo off
rem ===========================================================================
rem  Console do assessor - XP
rem
rem  Duplo clique neste arquivo. Ele regenera a carta, o anexo e o console a
rem  partir dos dados de origem, e abre o console no navegador.
rem
rem  POR QUE ESTE ARQUIVO EXISTE
rem  O pipeline inteiro roda com "npm run build". Isso serve para quem
rem  desenvolve e nao serve para um assessor com 300 clientes e nenhum motivo
rem  para aprender um terminal. Um produto que so pode ser acessado por linha
rem  de comando nao esta entregue.
rem
rem  SE VOCE SO QUER LER
rem  O arquivo solution\out\console.html ja abre com duplo clique, sem Node e
rem  sem nada instalado. Este .cmd so e necessario para REGENERAR os documentos
rem  a partir de um extrato novo.
rem
rem  NOTA SOBRE ACENTOS: o texto deste arquivo e proposital sem acentuacao. O
rem  console do Windows troca de codepage conforme a maquina, e uma mensagem de
rem  erro ilegivel na hora exata em que algo falhou e pior do que uma mensagem
rem  sem acento.
rem ===========================================================================

setlocal
cd /d "%~dp0solution"

echo.
echo   XP - gerando carta, anexo e console
echo   ------------------------------------------------------------
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js nao foi encontrado nesta maquina.
  echo.
  echo   Instale a versao LTS em https://nodejs.org e rode este arquivo de novo.
  echo   Para apenas LER os documentos ja gerados, abra:
  echo     solution\out\console.html
  echo.
  pause
  exit /b 1
)

call npm.cmd run build
if errorlevel 1 (
  echo.
  echo   ------------------------------------------------------------
  echo   A geracao falhou. O erro esta acima.
  echo.
  echo   A causa mais comum e falta de internet: o motor consulta o Banco
  echo   Central, a CVM e o provedor de cotacoes. Os documentos anteriores
  echo   continuam validos em solution\out.
  echo   ------------------------------------------------------------
  echo.
  pause
  exit /b 1
)

echo.
echo   Pronto. Abrindo o console...
start "" "%~dp0solution\out\console.html"
exit /b 0
