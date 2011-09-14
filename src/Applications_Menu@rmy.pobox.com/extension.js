
const Gdm = imports.gi.Gdm;
const DBus = imports.dbus;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;

const GnomeSession = imports.misc.gnomeSession;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const EndSessionDialog = imports.ui.endSessionDialog;

const Gettext = imports.gettext;
const _ = Gettext.domain('gnome-shell').gettext;

const BUS_NAME = 'org.gnome.ScreenSaver';
const OBJECT_PATH = '/org/gnome/ScreenSaver';

const LOCKDOWN_SCHEMA = 'org.gnome.desktop.lockdown';
const DISABLE_USER_SWITCH_KEY = 'disable-user-switching';
const DISABLE_LOCK_SCREEN_KEY = 'disable-lock-screen';
const DISABLE_LOG_OUT_KEY = 'disable-log-out';

const ScreenSaverInterface = {
    name: BUS_NAME,
    methods: [ { name: 'Lock', inSignature: '' } ]
};


let _f = null;
let lastOpened = null;

function ApplicationMenuItem() {
    this._init.apply(this, arguments);
}

ApplicationMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function(app, params) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);

        let box = new St.BoxLayout({ name: 'applicationMenuBox',
                                     style_class: 'application-menu-box'});
        this.addActor(box);

        let icon = app.create_icon_texture(24);
        box.add(icon);

        let label = new St.Label({ text: app.get_name() });
        box.add(label);

        this.app = app;

        this.connect('activate', Lang.bind(this, function() {
            let app = Shell.AppSystem.get_default().get_app(this.app.get_id());
            app.open_new_window(-1);
        }));
    }
};

function ApplicationsMenuButton(path) {
    this._init(path);
}

ApplicationsMenuButton.prototype = {
    __proto__: PanelMenu.Button.prototype,

    _init: function(path) {
        this._path = path;
        PanelMenu.Button.prototype._init.call(this, 0.0);
        let label = new St.Label({ text: _f("Menu") });
        this.actor.set_child(label);

        this._buildMenu();

        Shell.AppSystem.get_default().connect('installed-changed', Lang.bind(this, this._rebuildMenu));

        let themeContext = St.ThemeContext.get_for_stage(global.stage);
        themeContext.connect('changed', Lang.bind(this, this._themeChanged));
    },

    _buildMenu: function() {
        let appSystem = Shell.AppSystem.get_default();
        let sections = appSystem.get_sections();

        for ( let i=0; i<sections.length; ++i ) {
        
            let submenu = createPopupSubMenuMenuItem(sections[i]);
            this.menu.addMenuItem(submenu);

            let apps = appSystem.get_flattened_apps().filter(function(app) {
                           return !app.get_is_nodisplay() &&
                               sections[i] == app.get_section();
                       });

            for ( let j=0; j<apps.length; ++j ) {
                let menuItem = new ApplicationMenuItem(apps[j]);

                submenu.menu.addMenuItem(menuItem, 0);
            }
        }

        createSessionItems(this.menu);
    },

    _rebuildMenu: function() {
        this.menu.removeAll();
        this._buildMenu();
    },

    _themeChanged: function(themeContext) {
        let theme = themeContext.get_theme();
        let dir = Gio.file_new_for_path(this._path);
        let stylesheetFile = dir.get_child('stylesheet.css');
        if (stylesheetFile.query_exists(null)) {
            try {
                theme.load_stylesheet(stylesheetFile.get_path());
            } catch (e) {
                global.logError(baseErrorString + 'Stylesheet parse error: ' + e);
                return;
            }
        }
    }
};

/**
 * Hide the last application menu section before open other section.
 */
function createPopupSubMenuMenuItem(label) {

    let submenu = new PopupMenu.PopupSubMenuMenuItem(label);
    
    /*submenu.menu.open = Lang.bind(submenu.menu, function(animate) {
        if (lastOpened && lastOpened.isOpen) {
            lastOpened.close(true);
        }
        lastOpened = this;
        try {
            this.__proto__.open.call(this, animate);
        } catch(e) {
            global.logError(e);
        }
    });*/
    
    submenu.menu._needsScrollbar = Lang.bind(submenu.menu, function() {
        let items = this._getMenuItems();
        return items.length > 10;
    });
    
    return submenu;
}

/**
 * Add session options to the applications menu.
 */
function createSessionItems(menu) {

    updateShutdownMenuItem();
    updateEndSessionDialog();
    removeStatusMenu();
    
    let statusmenu = Main.panel._statusmenu;
    let item = null;

    item = new PopupMenu.PopupSeparatorMenuItem();
    menu.addMenuItem(item);

    item = new PopupMenu.PopupMenuItem(_("Lock Screen"));
    item.connect('activate', Lang.bind(statusmenu, statusmenu._onLockScreenActivate));
    menu.addMenuItem(item);

    item = new PopupMenu.PopupMenuItem(_("Switch User"));
    item.connect('activate', Lang.bind(statusmenu, statusmenu._onLoginScreenActivate));
    menu.addMenuItem(item);

    item = new PopupMenu.PopupMenuItem(_("Log Out..."));
    item.connect('activate', Lang.bind(statusmenu, statusmenu._onQuitSessionActivate));
    menu.addMenuItem(item);

    item = new PopupMenu.PopupSeparatorMenuItem();
    menu.addMenuItem(item);

    item = new PopupMenu.PopupMenuItem(_("Power Off..."));
    item.connect('activate', Lang.bind(statusmenu, statusmenu._onSuspendOrPowerOffActivate));
    menu.addMenuItem(item);
}

/**
 * Make the SuspendOrPowerOff shows the label "Power Off".
 */
function updateShutdownMenuItem() {

    Main.panel._statusmenu._updateSuspendOrPowerOff = function() {
        this._haveSuspend = false;
        this._suspendOrPowerOffItem.updateText(_("Power Off..."), null);
    }

    Main.panel._statusmenu._updateSuspendOrPowerOff();
}

/**
 * Add some more buttons to the EndSession dialog.
 */
function updateEndSessionDialog() {

    const shutdownDialogContent = {
        subject: _("Power Off"),
        inhibitedDescription: _("Click Power Off to quit these applications and power off the system."),
        uninhibitedDescription: _("The system will power off automatically in %d seconds."),
        endDescription: _("Powering off the system."),
        secondaryButtons: [{ signal: 'ConfirmedSuspend',
                           label:  _("Suspend") },
                         { signal: 'ConfirmedHibernate',
                           label:  _("Hibernate") },
                         { signal: 'ConfirmedReboot',
                           label:  _("Restart") }],
        confirmButtons: [{ signal: 'ConfirmedShutdown',
                           label:  _("Power Off") }],
        iconName: 'system-shutdown',
        iconStyleClass: 'end-session-dialog-shutdown-icon'
    };

    EndSessionDialog.DialogContent[1] = shutdownDialogContent;

    EndSessionDialog.EndSessionDialog.prototype._onHibernate = function() {
        this._stopTimer();
        DBus.session.emit_signal('/org/gnome/SessionManager/EndSessionDialog',
                                 'org.gnome.SessionManager.EndSessionDialog',
                                 'Canceled', '', []);
        this.close(global.get_current_time());

        this._screenSaverProxy.LockRemote(Lang.bind(this, function() {
            this._upClient.hibernate_sync(null);
        }));
    };

    EndSessionDialog.EndSessionDialog.prototype._onSuspend = function() {
        this._stopTimer();
        DBus.session.emit_signal('/org/gnome/SessionManager/EndSessionDialog',
                                 'org.gnome.SessionManager.EndSessionDialog',
                                 'Canceled', '', []);
        this.close(global.get_current_time());

        this._screenSaverProxy.LockRemote(Lang.bind(this, function() {
            this._upClient.suspend_sync(null);
        }));
    };

    EndSessionDialog.EndSessionDialog.prototype._updateButtons = function() {
        let dialogContent = EndSessionDialog.DialogContent[this._type];
        let buttons = [];
        this._upClient = Main.panel._statusmenu._upClient;
        this._screenSaverProxy = Main.panel._statusmenu._screenSaverProxy;

        if ( dialogContent.secondaryButtons ) {
            for (let i = 0; i < dialogContent.secondaryButtons.length; i++) {
                let signal = dialogContent.secondaryButtons[i].signal;
                let label = dialogContent.secondaryButtons[i].label;

                if ( signal == 'ConfirmedHibernate' ) {
                    if ( this._upClient && this._upClient.get_can_hibernate() ) {
                        buttons.push({ action: Lang.bind(this, this._onHibernate),
                                       label: label });
                    }
                }
                else if ( signal == 'ConfirmedSuspend' ) {
                    if ( this._upClient && this._upClient.get_can_suspend() ) {
                        buttons.push({ action: Lang.bind(this, this._onSuspend),
                                       label: label });
                    }
                }
                else {
                    buttons.push({ action: Lang.bind(this, function() {
                                           this._confirm(signal);
                                       }),
                                   label: label });
                }
            }
        }

        buttons.push({ action: Lang.bind(this, this.cancel),
                         label:  _("Cancel"),
                         key:    Clutter.Escape });

        for (let i = 0; i < dialogContent.confirmButtons.length; i++) {
            let signal = dialogContent.confirmButtons[i].signal;
            let label = dialogContent.confirmButtons[i].label;
            buttons.push({ action: Lang.bind(this, function() {
                                       this._confirm(signal);
                                   }),
                           label: label });
        }

        this.setButtons(buttons);
    };
}

/**
 * Remove the StatusMenu from the panel but leave the instance because
 * other extensions or methods could be using it, included this one.
 */
function removeStatusMenu() {
    Main.panel._rightBox.remove_actor(Main.panel._statusmenu.actor);
}

function main(extensionMeta) {
    
    let localePath = extensionMeta.path + '/locale';
    Gettext.bindtextdomain('applications-menu', localePath);
    _f = Gettext.domain('applications-menu').gettext;
    
    let children = Main.panel._leftBox.get_children();
    Main.panel._leftBox.remove_actor(children[0]);

    let button = new ApplicationsMenuButton(extensionMeta.path);

    Main.panel._leftBox.insert_actor(button.actor, 0);
    Main.panel._menus.addMenu(button.menu);
}
