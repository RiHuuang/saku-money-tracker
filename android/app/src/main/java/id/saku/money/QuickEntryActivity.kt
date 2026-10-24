package id.saku.money

import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.graphics.Typeface
import android.view.Gravity
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import java.text.NumberFormat
import java.util.Locale

class QuickEntryActivity : AppCompatActivity() {
    private val spacing by lazy { (12 * resources.displayMetrics.density).toInt() }
    private val dark by lazy { SakuAppearance.isDark(this) }
    private val ink get() = if (dark) 0xffedf3ed.toInt() else 0xff203b33.toInt()
    private val muted get() = if (dark) 0xffaec3b5.toInt() else 0xff60746a.toInt()
    private val accent get() = if (dark) 0xff92d3b1.toInt() else 0xff176b55.toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        AppCompatDelegate.setDefaultNightMode(SakuAppearance.nightMode(this))
        super.onCreate(savedInstanceState)
        SakuAppearance.applyChrome(this)
        requestWindowFeature(Window.FEATURE_NO_TITLE)
        val mode = intent.getStringExtra(SakuWidgets.EXTRA_MODE) ?: "expense"
        val data = WidgetLedger.load(this)
        if (data == null) { finish(); return }
        val prefs = WidgetLedger.widgetPreferences(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(spacing * 2, spacing * 2, spacing * 2, spacing * 2)
            setBackgroundResource(if (dark) R.drawable.quick_entry_dark_dialog_background else R.drawable.quick_entry_dialog_background)
            clipToOutline = true
            elevation = spacing.toFloat()
        }
        root.addView(TextView(this).apply {
            text = when (mode) { "income" -> "Quick income"; "transfer" -> "Quick transfer"; else -> "Quick expense" }
            textSize = 21f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(ink)
        })
        val amount = labeledField(root, "Amount", "Whole rupiah", "Amount in rupiah", true)
        val description = if (mode == "transfer") null else labeledField(root, "Description", "Optional", "Transaction description")
        val error = TextView(this).apply { setTextColor(if (dark) 0xfff1939c.toInt() else 0xffad4051.toInt()); visibility = TextView.GONE }.also { root.addView(it) }
        val accountIds = data.accounts
        val paymentIds = if (mode == "expense") data.accounts + data.cards.map { it.id } else accountIds
        val paymentLabels = if (mode == "expense") data.accounts + data.cards.map { "Card · ${it.name}" } else accountIds
        val primary = spinner(if (mode == "transfer") "From account" else "Account or card", paymentLabels).also { root.addView(it.first) }.second
        val secondary = if (mode == "transfer") spinner("To account", accountIds).also { root.addView(it.first) }.second else null
        val pocketIds = listOf("") + data.pockets.map { it.id }
        val pocket = if (mode == "expense") spinner("Pocket", listOf("Unassigned") + data.pockets.map { it.name }).also { root.addView(it.first) }.second else null
        select(primary, paymentIds, prefs.getString("lastPayment:${data.userId}:$mode", null))
        if (secondary != null) select(secondary, accountIds, prefs.getString("lastTo:${data.userId}", null) ?: accountIds.getOrNull(1))
        if (pocket != null) select(pocket, pocketIds, prefs.getString("lastPocket:${data.userId}", null))
        val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, spacing, 0, 0) }
        actions.addView(Button(this).apply {
            text = "Cancel"; isAllCaps = false; setTextColor(accent)
            minHeight = spacing * 4
            setBackgroundResource(if (dark) R.drawable.widget_dark_soft_background else R.drawable.quick_entry_secondary_button)
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = spacing / 2 })
        actions.addView(Button(this).apply {
            text = "Save"; isAllCaps = false; setTextColor(if (dark) 0xff10231a.toInt() else 0xffffffff.toInt())
            minHeight = spacing * 4
            setBackgroundResource(if (dark) R.drawable.widget_dark_action_background else R.drawable.quick_entry_primary_button)
            setOnClickListener {
                val value = amount.text.toString().replace(".", "").replace(",", "").toLongOrNull()
                if (value == null) { showError(error, "Enter a whole rupiah amount greater than zero"); return@setOnClickListener }
                val result = if (mode == "transfer") WidgetLedger.addTransfer(this@QuickEntryActivity, value, accountIds[primary.selectedItemPosition], accountIds[secondary!!.selectedItemPosition])
                else WidgetLedger.addTransaction(this@QuickEntryActivity, mode, value, description?.text?.toString().orEmpty(), paymentIds[primary.selectedItemPosition], pocket?.let { pocketIds[it.selectedItemPosition] }.orEmpty())
                result.onSuccess {
                    prefs.edit().putString("lastPayment:${data.userId}:$mode", paymentIds[primary.selectedItemPosition])
                        .putString("lastPocket:${data.userId}", pocket?.let { pocketIds[it.selectedItemPosition] }.orEmpty())
                        .putString("lastTo:${data.userId}", secondary?.let { accountIds[it.selectedItemPosition] }).apply()
                    SakuWidgets.refreshAll(this@QuickEntryActivity)
                    finish()
                }.onFailure { showError(error, it.message ?: "Could not save transaction") }
            }
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = spacing / 2 })
        root.addView(actions)
        setContentView(ScrollView(this).apply { isFillViewport = true; addView(root) })
        setFinishOnTouchOutside(true)
        window.setBackgroundDrawableResource(android.R.color.transparent)
        window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
        window.attributes = window.attributes.apply { dimAmount = .24f; gravity = Gravity.CENTER }
        window.setLayout((resources.displayMetrics.widthPixels * .92).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT)
    }

    private fun labeledField(parent: LinearLayout, label: String, hint: String, description: String, amount: Boolean = false): EditText {
        val field = EditText(this).apply {
        this.hint = hint
        contentDescription = description
        setTextColor(ink); setHintTextColor(muted)
        minHeight = spacing * 4
        setPadding(spacing, spacing, spacing, spacing)
        if (amount) {
            inputType = InputType.TYPE_CLASS_NUMBER
            addTextChangedListener(object : TextWatcher {
                private var changing = false
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
                override fun afterTextChanged(value: Editable?) {
                    if (changing) return
                    val digits = value.toString().filter(Char::isDigit).take(13)
                    val formatted = digits.toLongOrNull()?.let { NumberFormat.getIntegerInstance(Locale("id", "ID")).format(it) }.orEmpty()
                    changing = true; setText(formatted); setSelection(formatted.length); changing = false
                }
            })
            requestFocus()
        }
        }
        parent.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, spacing / 2, 0, 0)
            addView(TextView(this@QuickEntryActivity).apply { text = label; textSize = 12f; setTextColor(muted) })
            addView(field)
        })
        return field
    }
    private fun spinner(label: String, values: List<String>): Pair<LinearLayout, Spinner> {
        val spinner = Spinner(this).apply { adapter = ArrayAdapter(this@QuickEntryActivity, android.R.layout.simple_spinner_dropdown_item, values); contentDescription = label; minimumHeight = spacing * 4 }
        return LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, spacing / 2, 0, 0); addView(TextView(this@QuickEntryActivity).apply { text = label; setTextColor(muted) }); addView(spinner) } to spinner
    }
    private fun select(spinner: Spinner, values: List<String>, value: String?) { values.indexOf(value).takeIf { it >= 0 }?.let(spinner::setSelection) }
    private fun showError(view: TextView, message: String) { view.text = message; view.visibility = TextView.VISIBLE }
}
