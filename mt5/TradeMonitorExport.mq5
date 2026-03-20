//+------------------------------------------------------------------+
//|                                           TradeMonitorExport.mq5 |
//|                                            Trade Monitoring Tool |
//|                    Script: Manual one-shot export to GitHub Gist  |
//+------------------------------------------------------------------+
#property copyright "Trade Monitor"
#property version   "1.00"
#property description "Manual trade data export to GitHub Gist (run once)"
#property script_show_inputs

#include <TradeMonitorLib.mqh>

//--- Input parameters
input string InpGistID       = "";              // Gist ID
input string InpGistToken    = "";              // Personal Access Token
input string InpGistFilename = "trades.json";   // Filename in Gist
input int    InpHistoryDays  = 0;               // History days (0=all)

//+------------------------------------------------------------------+
void OnStart()
{
   Print("=== TradeMonitor Manual Export ===");

   //--- Build JSON
   string json = TM_BuildJSON(InpHistoryDays);
   if(json == "")
   {
      Print("ERROR: Failed to build JSON");
      return;
   }

   Print("JSON built: ", StringLen(json), " bytes");

   //--- Check credentials
   if(InpGistID == "" || InpGistToken == "")
   {
      Print("No Gist credentials - saving to file instead");
      SaveToFile(json);
      return;
   }

   //--- Upload to Gist
   if(TM_SendToGist(InpGistID, InpGistToken, InpGistFilename, json))
   {
      Print("=== Export to Gist successful! ===");
      Alert("TradeMonitor: Export successful!");
   }
   else
   {
      Print("=== Export to Gist FAILED - saving to file as backup ===");
      SaveToFile(json);
      Alert("TradeMonitor: Export failed! Check Experts log.");
   }
}

//+------------------------------------------------------------------+
//| Save JSON to local file as backup/test                            |
//+------------------------------------------------------------------+
void SaveToFile(string &json)
{
   string filename = "TradeMonitor_" + TimeToString(TimeCurrent(), TIME_DATE) + ".json";
   StringReplace(filename, ".", "_");
   StringReplace(filename, ":", "_");
   filename += ".json";

   int handle = FileOpen(filename, FILE_WRITE|FILE_TXT|FILE_ANSI, 0, CP_UTF8);
   if(handle != INVALID_HANDLE)
   {
      FileWriteString(handle, json);
      FileClose(handle);
      Print("Saved to MQL5/Files/", filename);
      Alert("TradeMonitor: Saved to Files/" + filename);
   }
   else
      Print("ERROR: Could not create file, error=", GetLastError());
}
//+------------------------------------------------------------------+
