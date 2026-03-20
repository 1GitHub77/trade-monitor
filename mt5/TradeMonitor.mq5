//+------------------------------------------------------------------+
//|                                                 TradeMonitor.mq5 |
//|                                            Trade Monitoring Tool |
//|                   EA: Automatic weekly export to GitHub Gist      |
//+------------------------------------------------------------------+
#property copyright "Trade Monitor"
#property version   "1.00"
#property description "Automatic weekly trade data export to GitHub Gist"

#include <TradeMonitorLib.mqh>

//--- Input parameters
input group "=== GitHub Gist Settings ==="
input string InpGistID       = "";              // Gist ID
input string InpGistToken    = "";              // Personal Access Token
input string InpGistFilename = "trades.json";   // Filename in Gist

input group "=== Export Schedule ==="
input int    InpExportDay    = 6;               // Day of week (0=Sun, 6=Sat)
input int    InpExportHour   = 6;               // Export hour (server time)
input int    InpHistoryDays  = 0;               // History days (0=all)

input group "=== Options ==="
input bool   InpTestMode     = false;           // Test mode (export immediately)

//--- Global variables
bool     g_exportedThisWeek = false;
datetime g_lastExportTime   = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   if(InpGistID == "" || InpGistToken == "")
   {
      Print("ERROR: Gist ID and Token must be configured!");
      if(!InpTestMode)
         return INIT_PARAMETERS_INCORRECT;
   }

   EventSetTimer(3600);
   Print("TradeMonitor EA initialized. Export: day=", InpExportDay, " hour=", InpExportHour);

   if(InpTestMode)
   {
      Print("Test mode: exporting immediately...");
      DoExport();
   }

   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
}

//+------------------------------------------------------------------+
void OnTimer()
{
   MqlDateTime dt;
   TimeCurrent(dt);

   if(dt.day_of_week == 1)
      g_exportedThisWeek = false;

   if(dt.day_of_week == InpExportDay && dt.hour >= InpExportHour && !g_exportedThisWeek)
   {
      Print("Scheduled export triggered");
      if(DoExport())
      {
         g_exportedThisWeek = true;
         g_lastExportTime = TimeCurrent();
         Print("Export successful at ", TimeToString(g_lastExportTime));
      }
      else
         Print("Export failed, will retry next hour");
   }
}

//+------------------------------------------------------------------+
bool DoExport()
{
   string json = TM_BuildJSON(InpHistoryDays);
   if(json == "") { Print("ERROR: Failed to build JSON"); return false; }

   if(InpGistID == "" || InpGistToken == "")
   {
      Print("JSON built: ", StringLen(json), " bytes (no credentials, skipping upload)");
      return true;
   }

   return TM_SendToGist(InpGistID, InpGistToken, InpGistFilename, json);
}
//+------------------------------------------------------------------+
