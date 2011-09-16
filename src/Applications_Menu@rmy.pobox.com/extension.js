
const DBus = imports.dbus;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const GMenu = imports.gi.GMenu;

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


function AppViewByCategories(showAll) {
    this._init.apply(this, arguments);
}

AppViewByCategories.prototype = {
    _init: function(showAll) {
        this._showAll = typeof(showAll) == 'boolean' ? showAll : false;
        this._categories = [];
        this._applications = {};
        this._appSystem = Shell.AppSystem.get_default();
        this._load_categories();
    },
    
    get_categories: function() {
        return this._categories;
    },
    
    get_applications: function(category) {
        return this._applications[category];
    },
    
    _load_categories: function() {
    
        var tree = this._appSystem.get_tree();
        var root = tree.get_root_directory();

        var iter = root.iter();
        var nextType;
        
        while ((nextType = iter.next()) != GMenu.TreeItemType.INVALID) {
            if (nextType == GMenu.TreeItemType.DIRECTORY) {
                var appList = [];
                var dir = iter.get_directory();
                this._load_applications(dir, appList);
                
                this._categories.push(dir.get_name());
                this._applications[dir.get_name()] = appList;
            }
        }
    },
    
    _load_applications: function(dir, appList) {
    
        var iter = dir.iter();
        var nextType;
        
        while ((nextType = iter.next()) != GMenu.TreeItemType.INVALID) {
            if (nextType == GMenu.TreeItemType.ENTRY) {
                var entry = iter.get_entry();
                var app = this._appSystem.lookup_app_by_tree_entry(entry);
                if (this._showAll == true || !entry.get_app_info().get_nodisplay())
                    appList.push(app);
            } else if (nextType == GMenu.TreeItemType.DIRECTORY) {
                this._load_applications(iter.get_directory());
            }
        }
    }
};


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
    
        var v = new AppViewByCategories(false);
        var categories = v.get_categories();
        
        for (var i=0, cl=categories.length; i<cl; i++) {
        
            var category = categories[i];
            var apps = v.get_applications(category);
            
            var submenu = createPopupSubMenuMenuItem(category);
            this.menu.addMenuItem(submenu);
            
            for (var j=0, al=apps.length; j<al; j++) {
            
                var app = apps[j];
                var menuItem = new ApplicationMenuItem(app);
                submenu.menu.addMenuItem(menuItem, 0);
            }
        }

        //createSessionItems(this.menu);
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
            theme.load_stylesheet(stylesheetFile.get_path());
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
    Main.panel._rightBox.remove_actor(Main.panel._userMenu.actor);
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

function init(meta) {
    main(meta);
}

function enable() {
}

function disable() {
}

