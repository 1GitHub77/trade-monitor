//+------------------------------------------------------------------+
//|                                             TradeMonitorLib.mqh  |
//|                    Shared library for Trade Monitor EA & Script   |
//+------------------------------------------------------------------+
#ifndef TRADE_MONITOR_LIB_MQH
#define TRADE_MONITOR_LIB_MQH

//+------------------------------------------------------------------+
//| Build complete JSON payload                                       |
//+------------------------------------------------------------------+
string TM_BuildJSON(int historyDays = 0)
{
   string json = "{";

   //--- Account info
   json += "\"account\":{";
   json += TM_KV("login", AccountInfoInteger(ACCOUNT_LOGIN)) + ",";
   json += TM_KVS("server", AccountInfoString(ACCOUNT_SERVER)) + ",";
   json += TM_KVS("name", AccountInfoString(ACCOUNT_NAME)) + ",";
   json += TM_KVD("balance", AccountInfoDouble(ACCOUNT_BALANCE)) + ",";
   json += TM_KVD("equity", AccountInfoDouble(ACCOUNT_EQUITY)) + ",";
   json += TM_KVS("currency", AccountInfoString(ACCOUNT_CURRENCY));
   json += "},";

   //--- Deals
   json += "\"deals\":" + TM_BuildDealsJSON(historyDays) + ",";

   //--- Open positions
   json += "\"positions\":" + TM_BuildPositionsJSON() + ",";

   //--- Export metadata
   json += TM_KV("export_time", (long)TimeCurrent());

   json += "}";
   return json;
}

//+------------------------------------------------------------------+
//| Build deals JSON array                                            |
//+------------------------------------------------------------------+
string TM_BuildDealsJSON(int historyDays)
{
   datetime fromDate = 0;
   if(historyDays > 0)
      fromDate = TimeCurrent() - historyDays * 86400;

   if(!HistorySelect(fromDate, TimeCurrent()))
   {
      Print("ERROR: HistorySelect failed");
      return "[]";
   }

   int total = HistoryDealsTotal();
   string json = "[";
   bool first = true;
   int exported = 0;

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
      json += TM_KV("ticket", (long)ticket) + ",";
      json += TM_KV("order", HistoryDealGetInteger(ticket, DEAL_ORDER)) + ",";
      json += TM_KV("position_id", HistoryDealGetInteger(ticket, DEAL_POSITION_ID)) + ",";
      json += TM_KV("time", HistoryDealGetInteger(ticket, DEAL_TIME)) + ",";
      json += TM_KV("type", dealType) + ",";
      json += TM_KV("entry", dealEntry) + ",";
      json += TM_KV("magic", HistoryDealGetInteger(ticket, DEAL_MAGIC)) + ",";
      json += TM_KVS("symbol", HistoryDealGetString(ticket, DEAL_SYMBOL)) + ",";
      json += TM_KVD("volume", HistoryDealGetDouble(ticket, DEAL_VOLUME)) + ",";
      json += TM_KVDP("price", HistoryDealGetDouble(ticket, DEAL_PRICE), 6) + ",";
      json += TM_KVD("profit", HistoryDealGetDouble(ticket, DEAL_PROFIT)) + ",";
      json += TM_KVD("commission", HistoryDealGetDouble(ticket, DEAL_COMMISSION)) + ",";
      json += TM_KVD("swap", HistoryDealGetDouble(ticket, DEAL_SWAP)) + ",";
      json += TM_KVS("comment", HistoryDealGetString(ticket, DEAL_COMMENT));
      json += "}";
      exported++;
   }

   json += "]";
   Print("Deals: ", total, " total, ", exported, " exported (buy/sell only)");
   return json;
}

//+------------------------------------------------------------------+
//| Build open positions JSON array                                   |
//+------------------------------------------------------------------+
string TM_BuildPositionsJSON()
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

      // PositionGetTicket() already selects the position
      // Use property functions without ticket parameter
      json += "{";
      json += TM_KV("ticket", (long)ticket) + ",";
      json += TM_KV("magic", PositionGetInteger(POSITION_MAGIC)) + ",";
      json += TM_KVS("symbol", PositionGetString(POSITION_SYMBOL)) + ",";
      json += TM_KV("type", PositionGetInteger(POSITION_TYPE)) + ",";
      json += TM_KVD("volume", PositionGetDouble(POSITION_VOLUME)) + ",";
      json += TM_KVDP("price_open", PositionGetDouble(POSITION_PRICE_OPEN), 6) + ",";
      json += TM_KVDP("price_current", PositionGetDouble(POSITION_PRICE_CURRENT), 6) + ",";
      json += TM_KV("time", PositionGetInteger(POSITION_TIME)) + ",";
      json += TM_KVD("profit", PositionGetDouble(POSITION_PROFIT)) + ",";
      json += TM_KVD("swap", PositionGetDouble(POSITION_SWAP)) + ",";
      json += TM_KVS("comment", PositionGetString(POSITION_COMMENT));
      json += "}";
   }

   json += "]";
   Print("Open positions: ", total);
   return json;
}

//+------------------------------------------------------------------+
//| Send JSON to GitHub Gist                                          |
//+------------------------------------------------------------------+
bool TM_SendToGist(string gistID, string gistToken, string gistFilename, string &tradesJson)
{
   string url = "https://api.github.com/gists/" + gistID;

   string headers = "Authorization: Bearer " + gistToken + "\r\n"
                   + "Accept: application/vnd.github+json\r\n"
                   + "User-Agent: MT5-TradeMonitor\r\n"
                   + "Content-Type: application/json\r\n";

   //--- Escape JSON for embedding as string in Gist API body
   string escaped = tradesJson;
   StringReplace(escaped, "\\", "\\\\");
   StringReplace(escaped, "\"", "\\\"");
   StringReplace(escaped, "\n", "\\n");
   StringReplace(escaped, "\r", "\\r");
   StringReplace(escaped, "\t", "\\t");

   string body = "{\"files\":{\"" + gistFilename + "\":{\"content\":\"" + escaped + "\"}}}";

   char bodyData[];
   char result[];
   string resultHeaders;

   StringToCharArray(body, bodyData, 0, WHOLE_ARRAY, CP_UTF8);
   //--- Remove trailing null byte
   ArrayResize(bodyData, ArraySize(bodyData) - 1);

   Print("Sending to Gist... body size=", ArraySize(bodyData), " bytes");

   ResetLastError();
   int res = WebRequest("PATCH", url, headers, 30000, bodyData, result, resultHeaders);

   if(res == -1)
   {
      int err = GetLastError();
      Print("ERROR: WebRequest failed, code=", err);
      if(err == 4014)
         Print(">>> Add 'https://api.github.com' to Tools > Options > Expert Advisors > Allow WebRequest for listed URL");
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
      Print("ERROR: HTTP ", res, " - ", StringSubstr(response, 0, 500));
      return false;
   }
}

//+------------------------------------------------------------------+
//| JSON helpers                                                      |
//+------------------------------------------------------------------+
string TM_KVS(string key, string value)
{
   string v = value;
   StringReplace(v, "\\", "\\\\");
   StringReplace(v, "\"", "\\\"");
   return "\"" + key + "\":\"" + v + "\"";
}

string TM_KV(string key, long value)
{
   return "\"" + key + "\":" + IntegerToString(value);
}

string TM_KVD(string key, double value)
{
   return "\"" + key + "\":" + DoubleToString(value, 2);
}

string TM_KVDP(string key, double value, int digits)
{
   return "\"" + key + "\":" + DoubleToString(value, digits);
}

#endif
//+------------------------------------------------------------------+
