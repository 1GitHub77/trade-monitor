//+------------------------------------------------------------------+
//|                                                 TradeMonitor.mq5 |
//|                                            Trade Monitoring Tool |
//|                          Exports trade data to GitHub Gist (JSON)|
//+------------------------------------------------------------------+
#property copyright "Trade Monitor"
#property version   "1.00"
#property description "Weekly trade data export to GitHub Gist"

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
int      g_timerInterval    = 3600;             // Check every hour

//+------------------------------------------------------------------+
//| Expert initialization                                             |
//+------------------------------------------------------------------+
int OnInit()
{
   if(InpGistID == "" || InpGistToken == "")
   {
      Print("ERROR: Gist ID and Token must be configured!");
      if(!InpTestMode)
         return INIT_PARAMETERS_INCORRECT;
   }

   EventSetTimer(g_timerInterval);
   Print("TradeMonitor initialized. Export day=", InpExportDay,
         " hour=", InpExportHour, " test=", InpTestMode);

   if(InpTestMode)
   {
      Print("Test mode: exporting immediately...");
      if(DoExport())
         Print("Test export successful!");
      else
         Print("Test export failed!");
   }

   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization                                           |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
}

//+------------------------------------------------------------------+
//| Timer function                                                    |
//+------------------------------------------------------------------+
void OnTimer()
{
   MqlDateTime dt;
   TimeCurrent(dt);

   //--- Reset weekly flag on Monday
   if(dt.day_of_week == 1)
      g_exportedThisWeek = false;

   //--- Check if it's export time
   if(dt.day_of_week == InpExportDay && dt.hour >= InpExportHour && !g_exportedThisWeek)
   {
      Print("Export triggered: day=", dt.day_of_week, " hour=", dt.hour);
      if(DoExport())
      {
         g_exportedThisWeek = true;
         g_lastExportTime = TimeCurrent();
         Print("Export successful at ", TimeToString(g_lastExportTime));
      }
      else
      {
         Print("Export failed, will retry next hour");
      }
   }
}

//+------------------------------------------------------------------+
//| Main export function                                              |
//+------------------------------------------------------------------+
bool DoExport()
{
   string json = BuildJSON();
   if(json == "")
   {
      Print("ERROR: Failed to build JSON");
      return false;
   }

   if(InpGistID == "" || InpGistToken == "")
   {
      //--- Test mode: just print the JSON size
      Print("JSON built successfully, size=", StringLen(json), " bytes");
      Print("Skipping upload (no Gist credentials)");
      return true;
   }

   return SendToGist(json);
}

//+------------------------------------------------------------------+
//| Build complete JSON payload                                       |
//+------------------------------------------------------------------+
string BuildJSON()
{
   string json = "{";

   //--- Account info
   json += "\"account\":{";
   json += KV("login", AccountInfoInteger(ACCOUNT_LOGIN)) + ",";
   json += KVS("server", AccountInfoString(ACCOUNT_SERVER)) + ",";
   json += KVS("name", AccountInfoString(ACCOUNT_NAME)) + ",";
   json += KVD("balance", AccountInfoDouble(ACCOUNT_BALANCE)) + ",";
   json += KVD("equity", AccountInfoDouble(ACCOUNT_EQUITY)) + ",";
   json += KVS("currency", AccountInfoString(ACCOUNT_CURRENCY));
   json += "},";

   //--- Deals
   json += "\"deals\":" + BuildDealsJSON() + ",";

   //--- Open positions
   json += "\"positions\":" + BuildPositionsJSON() + ",";

   //--- Export metadata
   json += KV("export_time", (long)TimeCurrent());

   json += "}";
   return json;
}

//+------------------------------------------------------------------+
//| Build deals JSON array                                            |
//+------------------------------------------------------------------+
string BuildDealsJSON()
{
   datetime fromDate = 0;
   if(InpHistoryDays > 0)
      fromDate = TimeCurrent() - InpHistoryDays * 86400;

   if(!HistorySelect(fromDate, TimeCurrent()))
   {
      Print("ERROR: HistorySelect failed");
      return "[]";
   }

   int total = HistoryDealsTotal();
   string json = "[";
   bool first = true;

   for(int i = 0; i < total; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0) continue;

      long dealType  = HistoryDealGetInteger(ticket, DEAL_TYPE);
      long dealEntry = HistoryDealGetInteger(ticket, DEAL_ENTRY);

      //--- Skip balance/credit/correction operations
      if(dealType > DEAL_TYPE_SELL) continue;

      if(!first) json += ",";
      first = false;

      json += "{";
      json += KV("ticket", (long)ticket) + ",";
      json += KV("order", HistoryDealGetInteger(ticket, DEAL_ORDER)) + ",";
      json += KV("position_id", HistoryDealGetInteger(ticket, DEAL_POSITION_ID)) + ",";
      json += KV("time", HistoryDealGetInteger(ticket, DEAL_TIME)) + ",";
      json += KV("type", dealType) + ",";
      json += KV("entry", dealEntry) + ",";
      json += KV("magic", HistoryDealGetInteger(ticket, DEAL_MAGIC)) + ",";
      json += KVS("symbol", HistoryDealGetString(ticket, DEAL_SYMBOL)) + ",";
      json += KVD("volume", HistoryDealGetDouble(ticket, DEAL_VOLUME)) + ",";
      json += KVDP("price", HistoryDealGetDouble(ticket, DEAL_PRICE), 6) + ",";
      json += KVD("profit", HistoryDealGetDouble(ticket, DEAL_PROFIT)) + ",";
      json += KVD("commission", HistoryDealGetDouble(ticket, DEAL_COMMISSION)) + ",";
      json += KVD("swap", HistoryDealGetDouble(ticket, DEAL_SWAP)) + ",";
      json += KVS("comment", HistoryDealGetString(ticket, DEAL_COMMENT));
      json += "}";
   }

   json += "]";
   Print("Deals exported: ", total, " found, JSON length: ", StringLen(json));
   return json;
}

//+------------------------------------------------------------------+
//| Build open positions JSON array                                   |
//+------------------------------------------------------------------+
string BuildPositionsJSON()
{
   int total = PositionsTotal();
   string json = "[";
   bool first = true;

   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;

      if(!first) json += ",";
      first = false;

      json += "{";
      json += KV("ticket", (long)ticket) + ",";
      json += KV("magic", PositionGetInteger(ticket, POSITION_MAGIC)) + ",";
      json += KVS("symbol", PositionGetString(ticket, POSITION_SYMBOL)) + ",";
      json += KV("type", PositionGetInteger(ticket, POSITION_TYPE)) + ",";
      json += KVD("volume", PositionGetDouble(ticket, POSITION_VOLUME)) + ",";
      json += KVDP("price_open", PositionGetDouble(ticket, POSITION_PRICE_OPEN), 6) + ",";
      json += KVDP("price_current", PositionGetDouble(ticket, POSITION_PRICE_CURRENT), 6) + ",";
      json += KV("time", PositionGetInteger(ticket, POSITION_TIME)) + ",";
      json += KVD("profit", PositionGetDouble(ticket, POSITION_PROFIT)) + ",";
      json += KVD("commission", PositionGetDouble(ticket, POSITION_COMMISSION)) + ",";
      json += KVD("swap", PositionGetDouble(ticket, POSITION_SWAP)) + ",";
      json += KVS("comment", PositionGetString(ticket, POSITION_COMMENT));
      json += "}";
   }

   json += "]";
   Print("Open positions exported: ", total);
   return json;
}

//+------------------------------------------------------------------+
//| Send JSON to GitHub Gist                                          |
//+------------------------------------------------------------------+
bool SendToGist(string &tradesJson)
{
   string url = "https://api.github.com/gists/" + InpGistID;

   string headers = "Authorization: Bearer " + InpGistToken + "\r\n"
                  + "Accept: application/vnd.github+json\r\n"
                  + "User-Agent: MT5-TradeMonitor\r\n"
                  + "Content-Type: application/json\r\n";

   //--- Build Gist API body: {"files":{"trades.json":{"content":"..."}}}
   string escaped = tradesJson;
   StringReplace(escaped, "\\", "\\\\");
   StringReplace(escaped, "\"", "\\\"");
   StringReplace(escaped, "\n", "\\n");
   StringReplace(escaped, "\r", "\\r");
   StringReplace(escaped, "\t", "\\t");

   string body = "{\"files\":{\"" + InpGistFilename + "\":{\"content\":\"" + escaped + "\"}}}";

   char bodyData[];
   char result[];
   string resultHeaders;

   StringToCharArray(body, bodyData, 0, WHOLE_ARRAY, CP_UTF8);
   //--- Remove trailing null byte that StringToCharArray adds
   ArrayResize(bodyData, ArraySize(bodyData) - 1);

   Print("Sending to Gist... URL=", url, " body size=", ArraySize(bodyData));

   ResetLastError();
   int res = WebRequest("PATCH", url, headers, 30000, bodyData, result, resultHeaders);

   if(res == -1)
   {
      int err = GetLastError();
      Print("ERROR: WebRequest failed, code=", err);
      if(err == 4014)
         Print("Add 'https://api.github.com' to Tools > Options > Expert Advisors > Allow WebRequest for listed URL");
      return false;
   }

   string response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);

   if(res == 200)
   {
      Print("Gist updated successfully (HTTP 200)");
      return true;
   }
   else
   {
      Print("ERROR: HTTP ", res, " response: ", StringSubstr(response, 0, 500));
      return false;
   }
}

//+------------------------------------------------------------------+
//| JSON helper: key-value string                                     |
//+------------------------------------------------------------------+
string KVS(string key, string value)
{
   string v = value;
   StringReplace(v, "\\", "\\\\");
   StringReplace(v, "\"", "\\\"");
   return "\"" + key + "\":\"" + v + "\"";
}

//+------------------------------------------------------------------+
//| JSON helper: key-value long                                       |
//+------------------------------------------------------------------+
string KV(string key, long value)
{
   return "\"" + key + "\":" + IntegerToString(value);
}

//+------------------------------------------------------------------+
//| JSON helper: key-value double (2 decimals)                        |
//+------------------------------------------------------------------+
string KVD(string key, double value)
{
   return "\"" + key + "\":" + DoubleToString(value, 2);
}

//+------------------------------------------------------------------+
//| JSON helper: key-value double (custom precision)                  |
//+------------------------------------------------------------------+
string KVDP(string key, double value, int digits)
{
   return "\"" + key + "\":" + DoubleToString(value, digits);
}
//+------------------------------------------------------------------+
