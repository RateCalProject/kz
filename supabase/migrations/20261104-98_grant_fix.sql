-- ログインした人が呼べなくなっていた関数を、呼べるようにもどす（DB の更新90の見落とし）：列車を保存する・まとめて足す・運用を自動で組む・運用をまとめて変える・車両をまとめて注文する など
--   DB の更新90 で「ログインなしでは呼べない」ようにしたとき、前に形を変えた関数のうち、ログインした人への許可がついていなかったもの（だれでも呼べる、で動いていた）が、
--   ログインしても呼べなくなっていた（permission denied）。画面から呼ぶ関数（schema.sql の一覧にあるもの）を、ログインした人が呼べるようにする。ログインなし（anon）は呼べないまま

do $$
declare f record; n int := 0;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public' and p.prokind = 'f' and left(p.proname, 1) <> '_' and not has_function_privilege('authenticated', p.oid, 'execute')
              and p.proname in (
              'ad_admin','ad_begin','ad_end','ad_info','admin_ai','admin_ai_fund','admin_ai_news','admin_ai_set','admin_banner_end',
              'admin_banner_save','admin_banners','admin_beta_get','admin_beta_set','admin_corp_action','admin_corp_cert','admin_corp_decide',
              'admin_corp_servers_clear','admin_court_decide','admin_fx_decide','admin_fx_fee','admin_gov_share_give','admin_grant','admin_grant_who',
              'admin_intervene','admin_iv_state','admin_kb_extra','admin_kb_extra_cancel','admin_kb_extras','admin_pub_hide','admin_staff',
              'admin_staff_set','admin_state','admin_stock_decide','admin_stock_delist','admin_stock_reprice','admin_user','admin_user_email',
              'admin_users','app_ver','bank_acct_answer','bank_deposit','bank_open','bank_settings','bank_withdraw','banner_list','bj_double',
              'bj_hit','bj_stand','bj_start','bj_state','bt_bet','bt_join','bt_leave','bt_list','bt_lobby_set','bt_react','bt_state','bt_ticket',
              'corp_apply','corp_apply_answer','corp_buy','corp_ca_withdraw','corp_close','corp_days','corp_dividend','corp_fund','corp_item_save',
              'corp_job_save','corp_ledger_page','corp_member_desk','corp_member_set','corp_order_done','corp_owner_set','corp_page','corp_pay',
              'corp_pin','corp_pins','corp_search','corp_send','corp_set_industries','corp_set_servers','corp_share_offer','corp_shares_change',
              'corp_suspend','corp_update','corp_withdraw','court_defend','court_file','court_list','court_withdraw','desk_close','desk_list',
              'desk_open','desk_send','desk_settings','desk_thread','dm_list','dm_send','dm_thread','ensure_profile','exch_settings','fi_cast',
              'fi_consign','fi_hook','fi_join','fi_land','fi_state','friend_answer','friend_list','friend_remove','friend_request','fx_cancel',
              'fx_order','fx_request','fx_request_cancel','fx_state','gacha_pull','game_tasks','guest_extend','guest_set_email','guest_signup',
              'hc_feed','hc_mode','hc_release','hc_train','hc_vet','hilo_cashout','hilo_guess','hilo_start','hilo_state','home_widgets',
              'hx_admin_cancel','hx_admin_create','hx_admin_state','hx_bid','hx_buynow','hx_state','idea_inbox','idea_prio','idea_send','info_state',
              'info_stats_get','info_today','invoice_close','invoice_create','invoice_list','invoice_pay','job_apply','job_list','job_quit',
              'kb_alert_set','kb_sched','keiba_bet','keiba_day','keiba_horse','keiba_odds','keiba_race','leaderboard','loan_answer','loan_apply',
              'loan_cancel','loan_pack_save','loan_repay','lot_buy','lot_state','market_info','money_days','money_history','mp_admin_airport',
              'mp_admin_cho_merge','mp_admin_cho_split','mp_admin_lvset','mp_admin_place_at','mp_admin_rates','mp_admin_rename','mp_admin_state',
              'mp_admin_zone','mp_area','mp_attr_build','mp_attr_del','mp_attr_list','mp_bld_build','mp_bld_demolish','mp_bld_get','mp_bld_options',
              'mp_bld_quote','mp_bld_set','mp_blds_lite','mp_boot','mp_car_log','mp_car_move','mp_car_order','mp_car_scrap','mp_car_tmp',
              'mp_car_work','mp_cars_gone','mp_cars_list','mp_cho_get','mp_chunk_get','mp_chunk_lo','mp_cxl_add','mp_cxl_del','mp_dep_build',
              'mp_dep_edit','mp_dep_plow','mp_dia','mp_dia_fix','mp_dia_import','mp_dia_undo','mp_er_bld','mp_er_list','mp_er_now','mp_find',
              'mp_form_add','mp_form_del','mp_form_order','mp_form_order_many','mp_form_set','mp_form_spare','mp_fset_del','mp_fset_save',
              'mp_home_clear','mp_home_get','mp_home_set','mp_jam_list','mp_jam_now','mp_jm_cert','mp_jm_file','mp_jm_get','mp_jm_mine',
              'mp_jm_residents','mp_jm_seal','mp_kinds_list','mp_kinds_set','mp_land_buy','mp_land_decide','mp_land_req','mp_land_req_del',
              'mp_land_reqs','mp_ledger_days','mp_ledger_page','mp_lic_apply','mp_lic_at','mp_lic_cancel','mp_lic_decide','mp_lic_find','mp_lic_mine',
              'mp_lic_review','mp_makers','mp_op_backup_del','mp_op_backup_list','mp_op_backup_restore','mp_op_backup_save','mp_op_del',
              'mp_op_export','mp_op_import','mp_op_save','mp_ops_bulk','mp_ops_list','mp_parcel_buy','mp_parcel_merge','mp_parcel_rent',
              'mp_parcel_sell','mp_parcel_split','mp_poll','mp_route_branch','mp_route_del','mp_route_pat','mp_route_save','mp_route_xwait',
              'mp_routes_list','mp_routes_pub','mp_rwy_build','mp_rwy_del','mp_sc_list','mp_sc_set','mp_seg_build','mp_seg_color','mp_seg_del',
              'mp_seg_edit','mp_seg_find','mp_seg_height','mp_seg_join','mp_seg_opts','mp_seg_routes','mp_seg_sig','mp_seg_snow','mp_seg_speed',
              'mp_seg_split','mp_slot_admin','mp_slot_answer','mp_slot_apply','mp_slot_bid','mp_slot_cancel','mp_slot_get','mp_slot_list',
              'mp_slot_return','mp_snow_mine','mp_spot','mp_sta_build','mp_sta_edit','mp_sta_height','mp_sta_melt','mp_sta_resize','mp_sta_sup',
              'mp_sta_trk','mp_sta_trk_set','mp_stop_lend','mp_sub_build','mp_sub_del','mp_sub_set','mp_thru_answer','mp_thru_end','mp_thru_list',
              'mp_thru_req','mp_track_del','mp_track_find','mp_track_info','mp_track_list','mp_track_place','mp_track_rename','mp_train_autoform',
              'mp_train_autoform_k','mp_train_bulk','mp_train_del','mp_train_save','mp_unit_lease','mp_unit_leave','mp_unit_market','mp_unit_mine',
              'mp_unit_own','mp_unit_set','mp_unko_furi','mp_unko_list','mp_unko_make','mp_unko_opt','mp_unko_pick','mp_xfer_accept','mp_xfer_close',
              'mp_xfer_list','mp_xfer_offer','my_banks','my_corps','my_history','my_jobs','my_loans','my_orders','my_profile','my_pubs','my_stocks',
              'news_list','notice_count','notice_list','notice_read_all','owner_bid','owner_buy','owner_name','owner_reg','owner_retire','owner_sell',
              'owner_silks','owner_state','people_search','person_page','pr_bet','pr_day','pr_odds','pr_race','pr_racer','prefs_save','pub_buy',
              'pub_delete','pub_item_delete','pub_item_save','pub_list','pub_page','pub_read','pub_save','review_state','review_submit','room_bet',
              'room_chat','room_create','room_draw','room_join','room_leave','room_list','room_move','room_quit','room_resign','room_start',
              'room_state','roulette_spin','sec_admin_block','sec_admin_list','sec_admin_unblock','set_nickname','share_give','share_offer',
              'share_offer_answer','share_offer_cancel','slot_spin','stock_cancel','stock_chart','stock_list','stock_list_apply',
              'stock_list_withdraw','stock_order','stock_split','stock_state','support_close','support_list','support_open','support_send',
              'support_thread','tax_file','tax_pay','tax_state','tl_delete','tl_list','tl_post','transfer_preview','transfer_send','work_start',
              'work_state','work_submit') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
    n := n + 1;
  end loop;
  raise notice 'ログインした人が呼べるようにした関数：%こ', n;
end $$;
